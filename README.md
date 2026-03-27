# GeoSpoof

A browser extension that spoofs your geolocation for websites. Works with Google Search, Google Maps, and any site that uses the Geolocation API.

Available for **Firefox** (Manifest V2) and **Chrome** (Manifest V3).

![](/screenshot.jpg)

## Features

- **Spoof geolocation** on any website by overriding `navigator.geolocation`
- **Search for locations** using OpenStreetMap/Nominatim with autocomplete
- **Paste coordinates** directly (e.g. `48.8566, 2.3522`) with automatic reverse geocoding
- **Save presets** for quick switching between locations
- **One-click toggle** to enable/disable spoofing globally

## Installation

### From stores

- Firefox Add-ons: *coming soon*
- Chrome Web Store: *coming soon*

### From source

1. Clone this repository
2. **Firefox**: Open `about:debugging` > "This Firefox" > "Load Temporary Add-on" > select `firefox/manifest.json`
3. **Chrome**: Open `chrome://extensions` > enable "Developer mode" > "Load unpacked" > select the `chrome/` directory

## Usage

1. Click the GeoSpoof icon in the toolbar
2. Search for a location or paste coordinates (e.g. `40.7128, -74.0060`)
3. Select a result — spoofing is enabled automatically and the icon turns orange
4. Click the toggle to disable/enable spoofing
5. Use "Save to presets" to bookmark locations for quick access

## Building

```sh
make build
```

This creates `dist/geospoof-firefox-<version>.zip` and `dist/geospoof-chrome-<version>.zip` ready for store submission.

## How it works

The extension intercepts calls to `navigator.geolocation.getCurrentPosition()`, `navigator.geolocation.watchPosition()`, and `navigator.permissions.query()` to return spoofed coordinates instead of your real location.

**Firefox** uses `wrappedJSObject` and `exportFunction` to override page globals directly from content scripts, bypassing Content Security Policy restrictions.

**Chrome** uses two content scripts: one in the `MAIN` world (page context) that overrides the Geolocation API, and one in the `ISOLATED` world that bridges communication with the background service worker.

## Project structure

```
firefox/                  Chrome/
  manifest.json (MV2)       manifest.json (MV3)
  background.js *            background.js *
  content.js                 content-main.js (MAIN world)
                             content-isolated.js (ISOLATED world)
  popup/ *                   popup/ *
    popup.html                 popup.html
    popup.css                  popup.css
    popup.js                   popup.js
  icons/                     icons/
    *.svg                      *.png

* = identical between Firefox and Chrome
```
