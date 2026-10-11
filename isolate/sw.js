/* RC service worker — pushes for the wrapped APK/EXE apps and PWA,
 * plus the offline app shell (cache-first offline reads of cached pages).
 *
 * Caching strategy (safe for both dev servers and production builds):
 *  - Navigations: network-first, cached index.html fallback → the app always
 *    loads fresh when online and still boots when offline.
 *  - Hashed build assets (/assets/*): cache-first (immutable content).
 *  - Other same-origin static files: network-first with cache fallback.
 *  - Cross-origin requests (the Convex cloud API) are never touched — the
 *    reactive queries re-sync incrementally on reconnect.
 *
 * The app posts { type: "SHOW_NOTIFICATION", title, body, tag } messages here;
 * real server pushes arrive via the standard "push" event (VAPID web-push). */

const SHELL_CACHE = "rc-shell-v1";
const PRECACHE_URLS = ["/", "/index.html", "/manifest.webmanifest", "/logo.svg"];
const STATIC_EXT = /\.(js|css|svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?|ttf|otf|json|webmanifest|map|wasm)$/i;

self.addEventListener("install", (event) => {
  self.skipWaiting();
  // Precache the shell defensively: one missing file must not fail install.
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await Promise.allSettled(
        PRECACHE_URLS.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: "reload" }));
          } catch (e) {
            /* optional precache entry */
          }
        }),
      );
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      // Drop every cache that is not the current shell — including legacy
      // names from before the rebrand, so no orphaned copy lingers.
      await Promise.all(
        names.filter((n) => n !== SHELL_CACHE).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

function cacheable(res) {
  return res && res.ok && res.type === "basic";
}

async function cacheFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (cacheable(res)) cache.put(req, res.clone()).catch(() => undefined);
  return res;
}

async function networkFirst(req, opts) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(req);
    if (cacheable(res)) cache.put(req, res.clone()).catch(() => undefined);
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    if (opts && opts.fallbackToRoot) {
      const shell = (await cache.match("/index.html")) || (await cache.match("/"));
      if (shell) return shell;
    }
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Convex cloud API etc.
  if (req.headers.has("range")) return; // media streaming — leave to the network

  if (req.mode === "navigate") {
    event.respondWith(networkFirst(req, { fallbackToRoot: true }));
    return;
  }
  if (url.pathname.startsWith("/assets/")) {
    // Vite production bundles are immutable + content-hashed.
    event.respondWith(cacheFirst(req));
    return;
  }
  if (STATIC_EXT.test(url.pathname)) {
    event.respondWith(networkFirst(req));
  }
  // Everything else falls through to the network untouched.
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "SHOW_NOTIFICATION" && self.registration.showNotification) {
    self.registration.showNotification(data.title || "RC", {
      body: data.body || "",
      tag: data.tag || "rc",
      renotify: Boolean(data.renotify),
      icon: "/logo.svg",
      badge: "/logo.svg",
      data: { url: data.url || "/" },
    });
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(target).catch(() => undefined);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});

// Real server pushes (VAPID web-push): payload is { title, body, tag, url }.
self.addEventListener("push", (event) => {
  let title = "RC";
  let body = "New update in the club inventory";
  let tag = "rc-push";
  let url = "/";
  try {
    if (event.data) {
      const payload = event.data.json();
      title = payload.title || title;
      body = payload.body || body;
      tag = payload.tag || tag;
      url = payload.url || url;
    }
  } catch (e) {
    if (event.data) body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      renotify: true,
      icon: "/logo.svg",
      badge: "/logo.svg",
      data: { url },
    }),
  );
});
