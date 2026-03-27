const api = globalThis.browser || globalThis.chrome;
const iconAction = api.browserAction || api.action;
const iconExt = api.browserAction ? "svg" : "png";
const isFirefox = !!api.browserAction;

let state = { enabled: false, location: null, presets: [], enabledDomains: [] };
let stateLoaded = false;

async function loadState() {
  const s = await api.storage.local.get(["enabled", "location", "presets", "enabledDomains"]);
  state = {
    enabled: s.enabled || false,
    location: s.location || null,
    presets: s.presets || [],
    enabledDomains: s.enabledDomains || [],
  };
  stateLoaded = true;
}

async function saveState() {
  await api.storage.local.set(state);
}

function iconPath(color) {
  return { 16: `icons/icon-${color}-16.${iconExt}`, 32: `icons/icon-${color}-32.${iconExt}`, 48: `icons/icon-${color}-48.${iconExt}` };
}

function updateIcon(tabId) {
  const c = state.enabled ? "orange" : "gray";
  const opts = { path: iconPath(c) };
  if (tabId) opts.tabId = tabId;
  iconAction.setIcon(opts);
}

async function updateIconForTab(tabId, url) {
  if (!url) {
    try {
      const tab = await api.tabs.get(tabId);
      url = tab.url;
    } catch {
      return;
    }
  }
  let origin;
  try {
    origin = new URL(url).origin;
  } catch {
    return;
  }
  const active = state.enabled && state.enabledDomains.includes(origin);
  iconAction.setIcon({ tabId, path: iconPath(active ? "orange" : "gray") });
}

async function updateAllTabIcons() {
  for (const tab of await api.tabs.query({})) {
    if (tab.id && tab.url) updateIconForTab(tab.id, tab.url);
  }
}

async function broadcastState() {
  const msg = { type: "stateChanged", enabled: state.enabled, location: state.location };
  for (const tab of await api.tabs.query({})) {
    api.tabs.sendMessage(tab.id, msg).catch(() => {});
  }
}

function getFullState() {
  return { enabled: state.enabled, location: state.location, presets: state.presets, enabledDomains: state.enabledDomains };
}

// --- Dynamic content script registration ---

function buildMatchPatterns() {
  return state.enabledDomains.map((origin) => {
    const url = new URL(origin);
    return `*://${url.hostname}/*`;
  });
}

async function syncContentScripts() {
  // Unregister existing scripts
  try {
    const ids = isFirefox ? ["geospoof-content"] : ["geospoof-main", "geospoof-isolated"];
    await api.scripting.unregisterContentScripts({ ids });
  } catch {
    // No scripts registered yet
  }

  const patterns = buildMatchPatterns();
  if (patterns.length === 0) return;

  if (isFirefox) {
    await api.scripting.registerContentScripts([
      {
        id: "geospoof-content",
        js: ["content.js"],
        matches: patterns,
        runAt: "document_start",
        allFrames: true,
        persistAcrossSessions: true,
      },
    ]);
  } else {
    await api.scripting.registerContentScripts([
      {
        id: "geospoof-main",
        js: ["content-main.js"],
        matches: patterns,
        runAt: "document_start",
        allFrames: true,
        world: "MAIN",
        persistAcrossSessions: true,
      },
      {
        id: "geospoof-isolated",
        js: ["content-isolated.js"],
        matches: patterns,
        runAt: "document_start",
        allFrames: true,
        persistAcrossSessions: true,
      },
    ]);
  }
}

// --- Google x-geo header injection ---
// Google reads an x-geo HTTP header for server-side location. This makes
// Google Search/Maps use the spoofed location immediately without caching issues.

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

function getEnabledGoogleHostnames() {
  return state.enabledDomains
    .map((origin) => { try { return new URL(origin).hostname; } catch { return null; } })
    .filter((h) => h && h.endsWith("google.com"));
}

async function syncGoogleHeaders() {
  // Remove existing rules
  try {
    await api.declarativeNetRequest.updateSessionRules({ removeRuleIds: XGEO_RULE_IDS });
  } catch {
    // API may not be available
    return;
  }

  if (!state.enabled || !state.location) return;

  const hostnames = getEnabledGoogleHostnames();
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
  } catch {
    // Silent fallback — Geolocation API spoofing still works
  }
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
      break;
    case "setLocation":
      state.location = msg.location;
      state.enabled = true;
      break;
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
      await syncContentScripts();
      await syncGoogleHeaders();
      updateAllTabIcons();
      return getFullState();
    case "disableDomain":
      state.enabledDomains = state.enabledDomains.filter((d) => d !== msg.origin);
      await saveState();
      await syncContentScripts();
      await syncGoogleHeaders();
      updateAllTabIcons();
      try {
        await api.permissions.remove({ origins: [msg.origin + "/*"] });
      } catch {
        // Permission may already be revoked
      }
      return getFullState();
    default:
      return null;
  }

  // toggle + setLocation both save, broadcast, sync headers, and update icons
  await saveState();
  broadcastState();
  await syncGoogleHeaders();
  updateAllTabIcons();
  return getFullState();
}

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg).then(sendResponse);
  return true;
});

// Update icon when user switches tabs or navigates
api.tabs.onActivated.addListener(({ tabId }) => updateIconForTab(tabId));
api.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "loading") {
    updateIconForTab(tabId, changeInfo.url || tab.url);
  }
});

// Startup: load state, re-register content scripts, sync headers, update icons
loadState().then(() => {
  syncContentScripts();
  syncGoogleHeaders();
  updateAllTabIcons();
});

if (api.runtime.onStartup) {
  api.runtime.onStartup.addListener(() => {
    loadState().then(() => syncContentScripts());
  });
}
