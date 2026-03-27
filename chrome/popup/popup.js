const api = globalThis.browser || globalThis.chrome;

const toggleEl = document.getElementById("toggle");
const currentLocationEl = document.getElementById("current-location");
const currentNameEl = document.getElementById("current-name");
const currentCoordsEl = document.getElementById("current-coords");
const searchInput = document.getElementById("search-input");
const searchResults = document.getElementById("search-results");
const presetsSection = document.getElementById("presets-section");
const presetsList = document.getElementById("presets-list");
const addPresetBtn = document.getElementById("add-preset-btn");
const addPresetEl = document.getElementById("add-preset");
const siteSection = document.getElementById("site-section");
const siteDomainEl = document.getElementById("site-domain");
const siteToggleBtn = document.getElementById("site-toggle-btn");
const siteReloadEl = document.getElementById("site-reload");

let currentState = null;
let currentOrigin = null;
let searchTimeout = null;
let lastRequestTime = 0;

// --- Helpers ---

function send(msg) {
  return api.runtime.sendMessage(msg);
}

function applyState(state) {
  currentState = state;
  render();
}

function reloadCurrentTab() {
  if (!currentOrigin?.startsWith("http")) return;
  api.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
    if (tabs[0]?.id) api.tabs.reload(tabs[0].id);
  });
}

async function reloadTabsByOrigin(origin) {
  for (const tab of await api.tabs.query({})) {
    try {
      if (tab.url && new URL(tab.url).origin === origin) api.tabs.reload(tab.id);
    } catch {}
  }
}

async function reloadEnabledTabs() {
  for (const tab of await api.tabs.query({})) {
    try {
      const origin = new URL(tab.url).origin;
      if (currentState.enabledDomains?.includes(origin)) api.tabs.reload(tab.id);
    } catch {}
  }
}

// --- Rendering ---

function render() {
  if (!currentState) return;

  toggleEl.checked = currentState.enabled;

  if (currentState.location) {
    currentLocationEl.classList.remove("hidden");
    currentNameEl.textContent = currentState.location.name;
    currentCoordsEl.textContent = `${currentState.location.lat.toFixed(4)}, ${currentState.location.lng.toFixed(4)}`;
    addPresetEl.classList.remove("hidden");
  } else {
    currentLocationEl.classList.add("hidden");
    addPresetEl.classList.add("hidden");
  }

  renderSiteSection();
  renderPresets();
}

function renderSiteSection() {
  if (!currentOrigin?.startsWith("http")) {
    siteSection.classList.add("hidden");
    return;
  }

  siteSection.classList.remove("hidden");
  siteDomainEl.textContent = new URL(currentOrigin).hostname;

  const enabled = currentState.enabledDomains?.includes(currentOrigin);
  siteToggleBtn.textContent = enabled ? "Disable on this site" : "Enable on this site";
  siteToggleBtn.classList.toggle("btn-disable", enabled);
  siteToggleBtn.classList.toggle("btn-enable", !enabled);
}

function renderPresets() {
  if (!currentState.presets?.length) {
    presetsSection.classList.add("hidden");
    return;
  }

  presetsSection.classList.remove("hidden");
  presetsList.replaceChildren();

  currentState.presets.forEach((preset, index) => {
    const item = document.createElement("div");
    item.className = "preset-item";

    const info = document.createElement("div");
    info.className = "preset-info";
    info.addEventListener("click", () => setLocation(preset));

    const nameEl = document.createElement("div");
    nameEl.className = "preset-name";
    nameEl.textContent = preset.name;

    const coordsEl = document.createElement("div");
    coordsEl.className = "preset-coords";
    coordsEl.textContent = `${preset.lat.toFixed(4)}, ${preset.lng.toFixed(4)}`;
    info.append(nameEl, coordsEl);

    const removeBtn = document.createElement("button");
    removeBtn.className = "preset-remove";
    removeBtn.textContent = "\u00d7";
    removeBtn.title = "Remove preset";
    removeBtn.addEventListener("click", () =>
      send({ type: "removePreset", index }).then((r) => {
        currentState.presets = r.presets;
        renderPresets();
      })
    );

    item.append(info, removeBtn);
    presetsList.appendChild(item);
  });
}

// --- Location actions ---

function setLocation(location) {
  send({ type: "setLocation", location }).then((state) => {
    applyState(state);
    reloadCurrentTab();
  });
}

// --- Nominatim search ---

async function rateLimitedFetch(url) {
  const wait = Math.max(0, 1000 - (Date.now() - lastRequestTime));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestTime = Date.now();
  return fetch(url, { headers: { "User-Agent": "GeoSpoof-Extension/1.0" } });
}

function parseCoords(input) {
  const m = input.match(/^\s*(-?\d+\.?\d*)\s*[,\s]\s*(-?\d+\.?\d*)\s*$/);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lng = parseFloat(m[2]);
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 ? { lat, lng } : null;
}

async function searchNominatim(query) {
  try {
    const res = await rateLimitedFetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=1`
    );
    showResults(await res.json());
  } catch {
    showMessage("Search failed");
  }
}

async function reverseGeocode(coords) {
  const fallback = [{ lat: String(coords.lat), lon: String(coords.lng), display_name: `${coords.lat}, ${coords.lng}` }];
  try {
    const res = await rateLimitedFetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${coords.lat}&lon=${coords.lng}&format=json`
    );
    const result = await res.json();
    showResults([{ lat: String(coords.lat), lon: String(coords.lng), display_name: result.display_name || fallback[0].display_name }]);
  } catch {
    showResults(fallback);
  }
}

// --- Search results display ---

function showMessage(text) {
  searchResults.replaceChildren();
  const msg = document.createElement("div");
  msg.className = "search-no-results";
  msg.textContent = text;
  searchResults.appendChild(msg);
  searchResults.classList.remove("hidden");
}

function formatResult(result) {
  const addr = result.address || {};
  const type = result.type || "";
  const category = result.class || "";

  let primary = addr.city || addr.town || addr.village || addr.hamlet || addr.municipality || "";
  let secondary = "";

  if (category === "boundary" || type === "administrative") {
    if (addr.state && !addr.city && !addr.town && !addr.village) {
      primary = addr.state;
      secondary = addr.country || "";
    } else if (addr.country && !addr.state && !addr.city) {
      primary = addr.country;
    }
  }

  if (!primary) {
    primary = result.name || result.display_name.split(",")[0];
  }

  if (!secondary) {
    const parts = [];
    if (addr.state && addr.state !== primary) parts.push(addr.state);
    if (addr.country && addr.country !== primary) parts.push(addr.country);
    secondary = parts.join(", ");
  }

  let label = "";
  if (type === "city" || addr.city) label = "City";
  else if (type === "town" || addr.town) label = "Town";
  else if (type === "village" || addr.village) label = "Village";
  else if (type === "state" || type === "state_district") label = "State";
  else if (type === "country") label = "Country";
  else if (type === "administrative") label = addr.state && !addr.city ? "State" : "Region";

  return { primary, secondary, label };
}

function showResults(results) {
  searchResults.replaceChildren();

  if (!results.length) {
    showMessage("No results found");
    return;
  }

  for (const result of results) {
    const item = document.createElement("div");
    item.className = "search-result-item";
    const formatted = formatResult(result);

    const nameRow = document.createElement("div");
    nameRow.className = "search-result-name";
    nameRow.textContent = formatted.primary;

    if (formatted.label) {
      const badge = document.createElement("span");
      badge.className = "search-result-badge";
      badge.textContent = formatted.label;
      nameRow.appendChild(badge);
    }

    item.appendChild(nameRow);

    if (formatted.secondary) {
      const sub = document.createElement("div");
      sub.className = "search-result-sub";
      sub.textContent = formatted.secondary;
      item.appendChild(sub);
    }

    item.addEventListener("click", () => {
      setLocation({ lat: parseFloat(result.lat), lng: parseFloat(result.lon), name: result.display_name });
      searchInput.value = "";
      searchResults.classList.add("hidden");
    });

    searchResults.appendChild(item);
  }
  searchResults.classList.remove("hidden");
}

// --- Initialization ---

async function init() {
  const tabs = await api.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]?.url) {
    try { currentOrigin = new URL(tabs[0].url).origin; } catch {}
  }
  applyState(await send({ type: "getState" }));
}

init();

// --- Event listeners ---

toggleEl.addEventListener("change", async () => {
  const wasEnabled = currentState.enabled;
  applyState(await send({ type: "toggle" }));
  if (wasEnabled && !currentState.enabled) reloadEnabledTabs();
});

siteToggleBtn.addEventListener("click", async () => {
  if (!currentOrigin) return;

  if (currentState.enabledDomains?.includes(currentOrigin)) {
    applyState(await send({ type: "disableDomain", origin: currentOrigin }));
    siteReloadEl.classList.add("hidden");
    reloadTabsByOrigin(currentOrigin);
  } else {
    const granted = await api.permissions.request({ origins: [currentOrigin + "/*"] });
    if (!granted) return;
    applyState(await send({ type: "enableDomain", origin: currentOrigin }));
    if (currentState.enabled) reloadTabsByOrigin(currentOrigin);
  }
});

searchInput.addEventListener("input", () => {
  clearTimeout(searchTimeout);
  const query = searchInput.value.trim();
  if (query.length < 3) {
    searchResults.classList.add("hidden");
    return;
  }
  const coords = parseCoords(query);
  searchTimeout = setTimeout(() => (coords ? reverseGeocode(coords) : searchNominatim(query)), 400);
});

searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    searchResults.classList.add("hidden");
    searchInput.blur();
  }
});

addPresetBtn.addEventListener("click", () => {
  if (!currentState.location) return;
  if (currentState.presets.some((p) => p.lat === currentState.location.lat && p.lng === currentState.location.lng)) return;
  send({ type: "addPreset", preset: currentState.location }).then((r) => {
    currentState.presets = r.presets;
    renderPresets();
  });
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-wrapper")) searchResults.classList.add("hidden");
});
