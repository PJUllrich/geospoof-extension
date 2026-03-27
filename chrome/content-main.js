// MAIN world script — runs in page context at document_start.
// Overrides navigator.geolocation using cached state received from
// content-isolated.js. All overrides are deferred until state arrives.

(function () {
  let cached = null;
  let pendingCallbacks = [];
  let pendingPermissions = [];

  const origGeo = navigator.geolocation;
  const origGetCurrentPosition = origGeo.getCurrentPosition.bind(origGeo);
  const origWatchPosition = origGeo.watchPosition.bind(origGeo);
  const origQuery = navigator.permissions.query.bind(navigator.permissions);

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data && event.data.type === "GEOSPOOF_STATE") {
      cached = { enabled: event.data.enabled, coords: event.data.coords };
      flushPending();
    }
  });

  function isActive() {
    return cached && cached.enabled && cached.coords;
  }

  function makePosition(lat, lng) {
    return {
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
    };
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
      success(makePosition(cached.coords.lat, cached.coords.lng));
    } else {
      origGetCurrentPosition(success, error, options);
    }
  }

  function doWatchPosition(success, error, options) {
    if (isActive()) {
      const { lat, lng } = cached.coords;
      success(makePosition(lat, lng));
      return setInterval(() => success(makePosition(lat, lng)), 5000);
    } else {
      return origWatchPosition(success, error, options);
    }
  }

  function resolvePermission(resolve, descriptor) {
    origQuery(descriptor).then((result) => {
      if (isActive()) {
        resolve(
          Object.create(result, {
            state: { value: "granted", enumerable: true },
          })
        );
      } else {
        resolve(result);
      }
    });
  }

  Object.defineProperty(origGeo, "getCurrentPosition", {
    value: function (success, error, options) {
      if (cached) {
        doGetCurrentPosition(success, error, options);
      } else {
        pendingCallbacks.push({ type: "getCurrentPosition", success, error, options });
      }
    },
    writable: false,
    configurable: false,
  });

  Object.defineProperty(origGeo, "watchPosition", {
    value: function (success, error, options) {
      if (cached) {
        return doWatchPosition(success, error, options);
      }
      pendingCallbacks.push({ type: "watchPosition", success, error, options });
      return 0;
    },
    writable: false,
    configurable: false,
  });

  Object.defineProperty(navigator.permissions, "query", {
    value: function (descriptor) {
      if (descriptor.name === "geolocation") {
        if (cached) {
          if (isActive()) {
            return origQuery(descriptor).then((result) =>
              Object.create(result, {
                state: { value: "granted", enumerable: true },
              })
            );
          }
          return origQuery(descriptor);
        }
        return new Promise((resolve) => {
          pendingPermissions.push({ resolve, descriptor });
        });
      }
      return origQuery(descriptor);
    },
    writable: false,
    configurable: false,
  });
})();
