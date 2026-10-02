/* Odoo 17 offline worker. API/RPC responses are never cached here. */
const CACHE_PREFIX = "odoo-offline-universal-v1";
const ASSET_CACHE = `${CACHE_PREFIX}-assets`;
const META_CACHE = `${CACHE_PREFIX}-meta`;
const SHELL_PREFIX = `${CACHE_PREFIX}-shell-`;
const OWNER_KEY = new URL("/__offline_universal__/owner", self.location.origin).toString();
const SHELL_KEY = new URL("/__offline_universal__/shell", self.location.origin).toString();

self.addEventListener("install", (event) => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter((key) => key.startsWith(`${CACHE_PREFIX}-`) &&
            key !== ASSET_CACHE && key !== META_CACHE && !key.startsWith(SHELL_PREFIX)).map((key) => caches.delete(key)));
        await self.clients.claim();
    })());
});

function ownerCacheName(owner) {
    return `${SHELL_PREFIX}${encodeURIComponent(owner || "unknown")}`;
}

async function readOwner() {
    const cache = await caches.open(META_CACHE);
    const response = await cache.match(OWNER_KEY);
    return response ? response.text() : null;
}

async function writeOwner(owner) {
    const cache = await caches.open(META_CACHE);
    await cache.put(OWNER_KEY, new Response(owner, { headers: { "Content-Type": "text/plain" } }));
}

function ownerFromHtml(html) {
    const match = html.match(/odoo\.__session_info__\s*=\s*(\{[\s\S]*?\});/);
    if (!match) return null;
    try {
        const info = JSON.parse(match[1]);
        if (!info.uid && !info.user_id) return null;
        return `${info.db || "database"}:${info.uid || info.user_id}`;
    } catch {
        return null;
    }
}

async function cacheShell(response) {
    const clone = response.clone();
    const html = await clone.text();
    const owner = ownerFromHtml(html);
    if (!owner) return;
    const oldOwner = await readOwner();
    if (oldOwner && oldOwner !== owner) {
        await caches.delete(ownerCacheName(oldOwner));
    }
    const cache = await caches.open(ownerCacheName(owner));
    await cache.put(SHELL_KEY, response.clone());
    await writeOwner(owner);
}

function offlinePage(message) {
    return new Response(`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Odoo hors ligne</title><body style="font:16px system-ui;max-width:40rem;margin:10vh auto;padding:1rem"><h1>Odoo est hors ligne</h1><p>${message}</p><p>Reconnectez-vous à Odoo et préparez le cache offline avant de réessayer.</p></body></html>`, {
        status: 503,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
}

function isBackendNavigation(request, url) {
    return request.mode === "navigate" && ["/web", "/web/", "/web/offline"].includes(url.pathname);
}

function isCacheablePublicAsset(request, url) {
    if (request.method !== "GET" || url.origin !== self.location.origin) return false;
    return url.pathname.startsWith("/web/assets/") || url.pathname.startsWith("/web/static/") || url.pathname.startsWith("/web/webclient/translations/");
}

function isCacheableUserResource(request, url) {
    if (request.method !== "GET" || url.origin !== self.location.origin) return false;
    return url.pathname.startsWith("/web/image/") || url.pathname.startsWith("/web/content/") || url.pathname.startsWith("/web/webclient/load_menus/");
}

self.addEventListener("message", (event) => {
    const message = event.data || {};
    event.waitUntil((async () => {
        let result = { ok: true };
        try {
            if (message.type === "PRECACHE_ASSETS") {
                const cache = await caches.open(ASSET_CACHE);
                const failures = [];
                let cached = 0;
                for (const url of message.urls || []) {
                    try {
                        const response = await fetch(url, { credentials: "same-origin" });
                        if (response.ok) {
                            await cache.put(url, response);
                            cached++;
                        } else {
                            failures.push(url);
                        }
                    } catch {
                        failures.push(url);
                    }
                }
                result = { ok: failures.length === 0, cached, failures };
            } else if (message.type === "SET_OWNER" && message.owner) {
                const oldOwner = await readOwner();
                if (oldOwner && oldOwner !== message.owner) await caches.delete(ownerCacheName(oldOwner));
                await writeOwner(message.owner);
            } else if (message.type === "PRECACHE_USER_URLS" && message.owner) {
                const cache = await caches.open(ownerCacheName(message.owner));
                const failures = [];
                let cached = 0;
                for (const value of message.urls || []) {
                    try {
                        const url = new URL(value, self.location.origin);
                        if (url.origin !== self.location.origin || !url.pathname.startsWith("/web/webclient/load_menus/")) {
                            failures.push(value);
                            continue;
                        }
                        const response = await fetch(url, { credentials: "same-origin" });
                        if (response.ok) {
                            await cache.put(url, response);
                            cached++;
                        } else {
                            failures.push(value);
                        }
                    } catch {
                        failures.push(value);
                    }
                }
                result = { ok: failures.length === 0, cached, failures };
            } else if (message.type === "CACHE_SHELL" && message.owner && typeof message.html === "string") {
                if (ownerFromHtml(message.html) !== message.owner) {
                    throw new Error("Le shell renvoyé ne correspond pas à l'utilisateur connecté.");
                }
                const oldOwner = await readOwner();
                if (oldOwner && oldOwner !== message.owner) await caches.delete(ownerCacheName(oldOwner));
                const cache = await caches.open(ownerCacheName(message.owner));
                await cache.put(SHELL_KEY, new Response(message.html, {
                    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
                }));
                await writeOwner(message.owner);
            } else if (message.type === "PURGE_OWNER") {
                const owner = await readOwner();
                if (owner) await caches.delete(ownerCacheName(owner));
                const cache = await caches.open(META_CACHE);
                await cache.delete(OWNER_KEY);
            } else {
                result = { ok: false, error: "Unknown service worker message." };
            }
        } catch (error) {
            result = { ok: false, error: String(error) };
        }
        event.ports?.[0]?.postMessage(result);
    })());
});

self.addEventListener("fetch", (event) => {
    const request = event.request;
    const url = new URL(request.url);

    if (isBackendNavigation(request, url)) {
        event.respondWith((async () => {
            try {
                const response = await fetch(request);
                if (response.ok && response.headers.get("content-type")?.includes("text/html")) {
                    await cacheShell(response);
                }
                return response;
            } catch {
                const owner = await readOwner();
                if (!owner) return offlinePage("Aucune session Odoo n'a encore été préparée sur cet appareil.");
                const cache = await caches.open(ownerCacheName(owner));
                return await cache.match(SHELL_KEY) || offlinePage("La page Odoo n'est pas encore en cache pour cet utilisateur.");
            }
        })());
        return;
    }

    if (isCacheablePublicAsset(request, url)) {
        event.respondWith((async () => {
            const cache = await caches.open(ASSET_CACHE);
            const cached = await cache.match(request);
            if (cached) {
                fetch(request).then((response) => {
                    if (response.ok) cache.put(request, response.clone());
                }).catch(() => {});
                return cached;
            }
            try {
                const response = await fetch(request);
                if (response.ok) await cache.put(request, response.clone());
                return response;
            } catch {
                return new Response("Asset Odoo absent du cache offline.", {
                    status: 503,
                    headers: { "Content-Type": "text/plain; charset=utf-8" },
                });
            }
        })());
        return;
    }

    if (isCacheableUserResource(request, url)) {
        event.respondWith((async () => {
            const owner = await readOwner();
            if (!owner) return new Response("Ressource utilisateur absente du cache offline.", { status: 503 });
            const cache = await caches.open(ownerCacheName(owner));
            const cached = await cache.match(request);
            if (cached) {
                fetch(request, { credentials: "same-origin" }).then((response) => {
                    if (response.ok) cache.put(request, response.clone());
                }).catch(() => {});
                return cached;
            }
            try {
                const response = await fetch(request);
                if (response.ok) await cache.put(request, response.clone());
                return response;
            } catch {
                return new Response("Ressource non disponible hors ligne.", { status: 503 });
            }
        })());
    }
    // All JSON-RPC and business endpoints pass through untouched.
});
