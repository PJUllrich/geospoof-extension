const api = globalThis.browser || globalThis.chrome;
const iconAction = api.browserAction || api.action;
const iconExt = api.browserAction ? "svg" : "png";
const isFirefox = !!api.browserAction;

let state = { enabled: true, location: null, presets: [], enabledDomains: [] };
let stateLoaded = false;

// --- Storage ---

async function loadState() {
  const s = await api.storage.local.get(["enabled", "location", "presets", "enabledDomains"]);
  state = {
    enabled: s.enabled !== undefined ? s.enabled : true,
    location: s.location || null,
    presets: s.presets || [],
    enabledDomains: s.enabledDomains || [],
  };
  stateLoaded = true;
}

async function saveState() {
  await api.storage.local.set(state);
}

function getFullState() {
  return { enabled: state.enabled, location: state.location, presets: state.presets, enabledDomains: state.enabledDomains };
}

// --- Icon management ---

function iconPath(color) {
  return { 16: `icons/icon-${color}-16.${iconExt}`, 32: `icons/icon-${color}-32.${iconExt}`, 48: `icons/icon-${color}-48.${iconExt}` };
}

async function updateIconForTab(tabId, url) {
  if (!url) {
    try { url = (await api.tabs.get(tabId)).url; } catch { return; }
  }
  let active = false;
  try {
    active = state.enabled && state.enabledDomains.includes(new URL(url).origin);
  } catch {}
  iconAction.setIcon({ tabId, path: iconPath(active ? "orange" : "gray") });
}

async function updateAllTabIcons() {
  for (const tab of await api.tabs.query({})) {
    if (tab.id && tab.url) updateIconForTab(tab.id, tab.url);
  }
}

// --- State broadcasting ---

async function broadcastState() {
  const msg = { type: "stateChanged", enabled: state.enabled, location: state.location };
  for (const tab of await api.tabs.query({})) {
    api.tabs.sendMessage(tab.id, msg).catch(() => {});
  }
}

// --- Dynamic content script registration ---

function buildMatchPatterns() {
  return state.enabledDomains.map((origin) => `*://${new URL(origin).hostname}/*`);
}

async function syncContentScripts() {
  try {
    const ids = isFirefox ? ["geospoof-content"] : ["geospoof-main", "geospoof-isolated"];
    await api.scripting.unregisterContentScripts({ ids });
  } catch {}

  const patterns = buildMatchPatterns();
  if (patterns.length === 0) return;

  const base = { matches: patterns, runAt: "document_start", allFrames: true, persistAcrossSessions: true };

  if (isFirefox) {
    await api.scripting.registerContentScripts([
      { id: "geospoof-content", js: ["content.js"], ...base },
    ]);
  } else {
    await api.scripting.registerContentScripts([
      { id: "geospoof-main", js: ["content-main.js"], world: "MAIN", ...base },
      { id: "geospoof-isolated", js: ["content-isolated.js"], ...base },
    ]);
  }
}

// --- Google x-geo header injection ---
// Google reads this HTTP header for server-side location, bypassing caching issues.

const XGEO_RULE_IDS = [1000, 1001];

function createXgeoHeader(lat, lng, radius = 6400) {
  const xgeo = [
    "role: CURRENT_LOCATION",
    "producer: DEVICE_LOCATION",
    `radius: ${radius}`,
    "latlng <",
    `  latitude_e7: ${Math.floor(lat * 1e7)}`,
    `  longitude_e7: ${Math.floor(lng * 1e7)}`,
    ">",
  ].join("\n");
  return "a " + btoa(xgeo);
}

async function syncGoogleHeaders() {
  try {
    await api.declarativeNetRequest.updateSessionRules({ removeRuleIds: XGEO_RULE_IDS });
  } catch { return; }

  if (!state.enabled || !state.location) return;

  const hostnames = state.enabledDomains
    .map((o) => { try { return new URL(o).hostname; } catch { return null; } })
    .filter((h) => h && h.endsWith("google.com"));

  if (hostnames.length === 0) return;

  const headerValue = createXgeoHeader(state.location.lat, state.location.lng);
  const addRules = hostnames.map((hostname, i) => ({
    id: XGEO_RULE_IDS[i] || 1000 + i,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [{ header: "x-geo", operation: "set", value: headerValue }],
    },
    condition: {
      urlFilter: `*://${hostname}/*`,
      resourceTypes: ["main_frame", "sub_frame", "xmlhttprequest"],
    },
  }));

  try {
    await api.declarativeNetRequest.updateSessionRules({ removeRuleIds: [], addRules });
  } catch {}
}

// --- Sync all dynamic state ---

async function syncAll() {
  await syncContentScripts();
  await syncGoogleHeaders();
  updateAllTabIcons();
}

// --- Message handling ---

async function handleMessage(msg) {
  if (!stateLoaded) await loadState();

  switch (msg.type) {
    case "getState":
      return getFullState();
    case "getLocation":
      return { enabled: state.enabled, location: state.location };

    case "toggle":
      state.enabled = !state.enabled;
      await saveState();
      broadcastState();
      await syncAll();
      return getFullState();

    case "setLocation":
      state.location = msg.location;
      state.enabled = true;
      await saveState();
      broadcastState();
      await syncAll();
      return getFullState();

    case "addPreset":
      state.presets.push(msg.preset);
      await saveState();
      return { presets: state.presets };

    case "removePreset":
      state.presets.splice(msg.index, 1);
      await saveState();
      return { presets: state.presets };

    case "enableDomain":
      if (!state.enabledDomains.includes(msg.origin)) {
        state.enabledDomains.push(msg.origin);
      }
      state.enabled = true;
      await saveState();
      await syncAll();
      return getFullState();

    case "disableDomain":
      state.enabledDomains = state.enabledDomains.filter((d) => d !== msg.origin);
      await saveState();
      await syncAll();
      try { await api.permissions.remove({ origins: [msg.origin + "/*"] }); } catch {}
      return getFullState();

    default:
      return null;
  }
}

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg).then(sendResponse);
  return true;
});

// --- Tab icon updates ---

api.tabs.onActivated.addListener(({ tabId }) => updateIconForTab(tabId));
api.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "loading") {
    updateIconForTab(tabId, changeInfo.url || tab.url);
  }
});

// --- Startup ---

loadState().then(syncAll);

if (api.runtime.onStartup) {
  api.runtime.onStartup.addListener(() => loadState().then(syncAll));
}
