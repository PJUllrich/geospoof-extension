// ISOLATED world script — has access to chrome.runtime APIs.
// Sends state to content-main.js on load and whenever it changes.

function postState(response) {
  const coords =
    response && response.enabled && response.location
      ? { lat: response.location.lat, lng: response.location.lng }
      : null;
  window.postMessage(
    { type: "GEOSPOOF_STATE", enabled: !!(response && response.enabled), coords },
    "*"
  );
}

// Pre-fetch on load
chrome.runtime.sendMessage({ type: "getLocation" }).then(postState);

// Keep MAIN world cache fresh when user changes location in popup
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "stateChanged") {
    postState(msg);
  }
});
