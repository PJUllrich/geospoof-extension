const api = globalThis.browser || globalThis.chrome;
const iconAction = api.browserAction || api.action;
const iconExt = api.browserAction ? "svg" : "png";

let state = { enabled: false, location: null, presets: [] };
let stateLoaded = false;

async function loadState() {
  const s = await api.storage.local.get(["enabled", "location", "presets"]);
  state = { enabled: s.enabled || false, location: s.location || null, presets: s.presets || [] };
  stateLoaded = true;
  updateIcon();
}

async function saveState() {
  await api.storage.local.set(state);
}

function updateIcon() {
  const c = state.enabled ? "orange" : "gray";
  iconAction.setIcon({
    path: { 16: `icons/icon-${c}-16.${iconExt}`, 32: `icons/icon-${c}-32.${iconExt}`, 48: `icons/icon-${c}-48.${iconExt}` },
  });
}

async function broadcastState() {
  const msg = { type: "stateChanged", enabled: state.enabled, location: state.location };
  for (const tab of await api.tabs.query({})) {
    api.tabs.sendMessage(tab.id, msg).catch(() => {});
  }
}

function getFullState() {
  return { enabled: state.enabled, location: state.location, presets: state.presets };
}

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
    default:
      return null;
  }

  // toggle + setLocation both update icon, save, and broadcast
  updateIcon();
  await saveState();
  broadcastState();
  return getFullState();
}

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg).then(sendResponse);
  return true;
});

loadState();
