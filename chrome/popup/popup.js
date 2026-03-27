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

let currentState = null;
let searchTimeout = null;
let lastRequestTime = 0;

// --- State & rendering ---

function send(msg) {
  return api.runtime.sendMessage(msg);
}

function applyState(state) {
  currentState = state;
  render();
}

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

  renderPresets();
}

function renderPresets() {
  if (!currentState.presets?.length) {
    presetsSection.classList.add("hidden");
    return;
  }

  presetsSection.classList.remove("hidden");
  presetsList.innerHTML = "";

  currentState.presets.forEach((preset, index) => {
    const item = document.createElement("div");
    item.className = "preset-item";

    const info = document.createElement("div");
    info.className = "preset-info";
    info.addEventListener("click", () =>
      send({ type: "setLocation", location: preset }).then(applyState)
    );
    info.innerHTML =
      `<div class="preset-name">${preset.name}</div>` +
      `<div class="preset-coords">${preset.lat.toFixed(4)}, ${preset.lng.toFixed(4)}</div>`;

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

// --- Nominatim helpers ---

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
    searchResults.innerHTML = '<div class="search-no-results">Search failed</div>';
    searchResults.classList.remove("hidden");
  }
}

async function reverseGeocode(coords) {
  const fallback = [{ lat: String(coords.lat), lon: String(coords.lng), display_name: `${coords.lat}, ${coords.lng}` }];
  try {
    const res = await rateLimitedFetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${coords.lat}&lon=${coords.lng}&format=json`
    );
    const result = await res.json();
    const name = result.display_name || fallback[0].display_name;
    showResults([{ lat: String(coords.lat), lon: String(coords.lng), display_name: name }]);
  } catch {
    showResults(fallback);
  }
}

function showResults(results) {
  searchResults.innerHTML = "";

  if (!results.length) {
    searchResults.innerHTML = '<div class="search-no-results">No results found</div>';
    searchResults.classList.remove("hidden");
    return;
  }

  for (const result of results) {
    const item = document.createElement("div");
    item.className = "search-result-item";
    item.innerHTML = `<div class="search-result-name">${result.display_name}</div>`;
    item.addEventListener("click", () => {
      send({
        type: "setLocation",
        location: { lat: parseFloat(result.lat), lng: parseFloat(result.lon), name: result.display_name },
      }).then(applyState);
      searchInput.value = "";
      searchResults.classList.add("hidden");
    });
    searchResults.appendChild(item);
  }
  searchResults.classList.remove("hidden");
}

// --- Event listeners ---

send({ type: "getState" }).then(applyState);

toggleEl.addEventListener("change", () => send({ type: "toggle" }).then(applyState));

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
