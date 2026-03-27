// Use Firefox's wrappedJSObject + exportFunction to override geolocation
// directly from the content script. This bypasses CSP restrictions entirely
// since no <script> element is injected into the page DOM.
//
// State is pre-fetched on load and kept fresh via stateChanged broadcasts.
// All overrides (getCurrentPosition, watchPosition, permissions.query) are
// deferred until the cache is ready, so a single refresh always works.

let cached = null;
let pendingCallbacks = [];
let pendingPermissions = [];

const pageGeo = window.wrappedJSObject.navigator.geolocation;
const origGetCurrentPosition = pageGeo.getCurrentPosition.bind(pageGeo);
const origWatchPosition = pageGeo.watchPosition.bind(pageGeo);

function makePosition(lat, lng) {
  return cloneInto(
    {
      coords: {
        latitude: lat,
        longitude: lng,
        accuracy: 100,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
      timestamp: Date.now(),
    },
    window.wrappedJSObject
  );
}

function isActive() {
  return cached && cached.enabled && cached.location;
}

function flushPending() {
  const cbs = pendingCallbacks;
  pendingCallbacks = [];
  for (const { type, success, error, options } of cbs) {
    if (type === "getCurrentPosition") {
      doGetCurrentPosition(success, error, options);
    } else {
      doWatchPosition(success, error, options);
    }
  }

  const perms = pendingPermissions;
  pendingPermissions = [];
  for (const { resolve, descriptor } of perms) {
    resolvePermission(resolve, descriptor);
  }
}

function doGetCurrentPosition(success, error, options) {
  if (isActive()) {
    success(makePosition(cached.location.lat, cached.location.lng));
  } else {
    origGetCurrentPosition(
      exportFunction(success, window.wrappedJSObject),
      error ? exportFunction(error, window.wrappedJSObject) : undefined,
      options
    );
  }
}

function doWatchPosition(success, error, options) {
  if (isActive()) {
    const lat = cached.location.lat;
    const lng = cached.location.lng;
    success(makePosition(lat, lng));
    return setInterval(() => success(makePosition(lat, lng)), 5000);
  } else {
    return origWatchPosition(
      exportFunction(success, window.wrappedJSObject),
      error ? exportFunction(error, window.wrappedJSObject) : undefined,
      options
    );
  }
}

function resolvePermission(resolve, descriptor) {
  origQuery(descriptor).then(
    exportFunction(function (result) {
      if (isActive()) {
        resolve(
          cloneInto(
            Object.create(result, {
              state: { value: "granted", enumerable: true },
            }),
            window.wrappedJSObject
          )
        );
      } else {
        resolve(result);
      }
    }, window.wrappedJSObject)
  );
}

exportFunction(
  function (success, error, options) {
    if (cached) {
      doGetCurrentPosition(success, error, options);
    } else {
      pendingCallbacks.push({ type: "getCurrentPosition", success, error, options });
    }
  },
  pageGeo,
  { defineAs: "getCurrentPosition" }
);

exportFunction(
  function (success, error, options) {
    if (cached) {
      return doWatchPosition(success, error, options);
    }
    pendingCallbacks.push({ type: "watchPosition", success, error, options });
    return 0;
  },
  pageGeo,
  { defineAs: "watchPosition" }
);

// Override navigator.permissions.query — also deferred until cache is ready
const pagePerms = window.wrappedJSObject.navigator.permissions;
const origQuery = pagePerms.query.bind(pagePerms);

exportFunction(
  function (descriptor) {
    if (descriptor.name === "geolocation") {
      if (cached) {
        if (isActive()) {
          return origQuery(descriptor).then(
            exportFunction(function (result) {
              return cloneInto(
                Object.create(result, {
                  state: { value: "granted", enumerable: true },
                }),
                window.wrappedJSObject
              );
            }, window.wrappedJSObject)
          );
        }
        return origQuery(descriptor);
      }
      // Cache not ready — return a page-world Promise that resolves once state arrives
      return new window.wrappedJSObject.Promise(
        exportFunction(function (resolve) {
          pendingPermissions.push({ resolve, descriptor });
        }, window.wrappedJSObject)
      );
    }
    return origQuery(descriptor);
  },
  pagePerms,
  { defineAs: "query" }
);

// Pre-fetch state on load
browser.runtime.sendMessage({ type: "getLocation" }).then((response) => {
  if (!cached) {
    cached = { enabled: response?.enabled, location: response?.location };
    flushPending();
  }
});

// Keep cache fresh when user changes location in popup
browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === "stateChanged") {
    cached = { enabled: msg.enabled, location: msg.location };
  }
});
