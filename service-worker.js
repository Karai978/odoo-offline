/**
 * service-worker.js
 */

const CACHE_NAME = "offline-sync-standalone-v24";

const ASSETS_TO_CACHE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./static/src/bundles/app.bundle.js",
  "./static/lib/dexie.min.js",
  "./static/lib/popper.js",
  "./css/style_login.css",
  "./static/src/webclient/home_menu/home_menu.css",
  "./css/web.assets_web.min.css",
  "./css/web.assets_frontend.min.css",
  "./css/fonts/fontawesome-webfont.woff",
  "./css/fonts/fontawesome-webfont.woff2",
  "./css/fonts/odoo_ui_icons.woff2",
  "./assets/menu.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/default-app.png",
  "./assets/search.png",
];

// Installation: minimal shell app caching (index.html + bundle + CSS/assets)
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

// Activation: cleaning up old, obsolete caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Request interception (Fetch)
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // NEVER intercept calls to the Odoo API (/offline sync/*)
  // — native network handling managed by core/network/rpc_service.js
  if (url.pathname.startsWith("/offline_sync/")) {
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", clone));
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Standard JS/CSS: network-first, cache-fallback (allows
  //    fetching a new app.bundle.js as soon as it is redeployed, while
  //    remaining usable offline with the last known version).
  if (
    url.origin === self.location.origin &&
    (url.pathname.endsWith(".js") || url.pathname.endsWith(".css"))
  ) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() =>
          caches.match(event.request).then(
            (cached) =>
              cached ||
              new Response("Fichier introuvable hors-ligne.", {
                status: 404,
                headers: { "Content-Type": "text/plain; charset=utf-8" },
              })
          )
        )
    );
    return;
  }

  // The rest (images, fonts, manifest.json): cache first, network as fallback
  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request).catch(() => new Response("", { status: 404 }))
    )
  );
});
