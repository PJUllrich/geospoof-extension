# Changelog

## 1.0.2

- Add `x-geo` header injection for Google domains — Google Search and Maps now reflect spoofed locations immediately without caching issues
- Add per-domain permissions — the extension only runs on sites you explicitly enable, no broad host permissions needed
- Add "Enable/Disable on this site" button in the popup
- Auto-reload affected tabs when enabling, disabling, or changing location
- Per-tab icon state — icon is orange only on sites where spoofing is active
- Remove all debug logging

## 1.0.1

- Switch from static `<all_urls>` content scripts to dynamic registration via `scripting.registerContentScripts()`
- Add `optional_host_permissions` (Chrome) / `optional_permissions` (Firefox) for per-domain permission requests
- Improve popup UX with colored enable/disable buttons and "Save to presets" styling
- Prepare manifests for Firefox Add-ons and Chrome Web Store submission

## 1.0.0

- Initial release
- Spoof `navigator.geolocation` on any website
- Override `navigator.permissions.query` to report geolocation as granted
- Search for locations using OpenStreetMap/Nominatim with autocomplete
- Paste coordinates with automatic reverse geocoding
- Save and manage location presets
- One-click global toggle with orange/gray icon indicator
- Firefox (MV2): uses `wrappedJSObject`/`exportFunction` to bypass CSP
- Chrome (MV3): uses MAIN world content scripts with ISOLATED world bridge
