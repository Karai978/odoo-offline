/** @odoo-module **/

function waitForActiveWorker(registration, scriptPath, timeoutMs = 20000) {
    const isReady = () => {
        const worker = registration.active;
        return worker?.state === "activated" && new URL(worker.scriptURL).pathname === scriptPath ? worker : null;
    };
    const current = isReady();
    if (current) return Promise.resolve(current);
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            clearTimeout(timer);
            registration.removeEventListener("updatefound", watchInstalling);
            navigator.serviceWorker.removeEventListener("controllerchange", check);
        };
        const check = () => {
            const worker = isReady();
            if (worker) {
                cleanup();
                resolve(worker);
            }
        };
        const watch = (worker) => worker?.addEventListener("statechange", check);
        const watchInstalling = () => watch(registration.installing);
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error("Le service worker offline n'est pas devenu actif."));
        }, timeoutMs);
        registration.addEventListener("updatefound", watchInstalling);
        navigator.serviceWorker.addEventListener("controllerchange", check);
        watch(registration.installing);
        watch(registration.waiting);
        watch(registration.active);
    });
}

function postMessageAndWait(worker, message, timeoutMs = 60000) {
    if (!worker || !globalThis.MessageChannel) return Promise.reject(new Error("Le service worker n'est pas joignable."));
    return new Promise((resolve, reject) => {
        const channel = new MessageChannel();
        const timer = setTimeout(() => {
            channel.port1.close();
            reject(new Error("Le service worker n'a pas confirmé la préparation offline."));
        }, timeoutMs);
        channel.port1.onmessage = (event) => {
            clearTimeout(timer);
            channel.port1.close();
            resolve(event.data);
        };
        worker.postMessage(message, [channel.port2]);
    });
}

export async function registerServiceWorker(owner = null, resources = {}) {
    if (!navigator.serviceWorker || (location.protocol !== "https:" && location.hostname !== "localhost")) {
        return null;
    }
    try {
        const registration = await navigator.serviceWorker.register(
            "/offline_universal_patch/service_worker.js",
            { scope: "/web" }
        );
        await navigator.serviceWorker.ready;
        const worker = await waitForActiveWorker(registration, "/offline_universal_patch/service_worker.js");
        if (!worker) return null;
        if (owner) await postMessageAndWait(worker, { type: "SET_OWNER", owner });
        const urls = [...performance.getEntriesByType("resource").map((entry) => entry.name), ...(resources.publicUrls || [])]
            .filter((url) => {
                try {
                    const parsed = new URL(url, location.href);
                    return parsed.origin === location.origin && (
                        parsed.pathname.startsWith("/web/assets/") ||
                        parsed.pathname.startsWith("/web/static/") ||
                        parsed.pathname.startsWith("/web/webclient/translations/")
                    );
                } catch {
                    return false;
                }
            });
        const assetsResult = await postMessageAndWait(worker, { type: "PRECACHE_ASSETS", urls: [...new Set(urls)] });
        const userResult = owner
            ? await postMessageAndWait(worker, { type: "PRECACHE_USER_URLS", owner, urls: resources.userUrls || [] })
            : { failures: [] };
        const menuResult = owner && resources.offlineMenus
            ? await postMessageAndWait(worker, { type: "CACHE_OFFLINE_MENUS", owner, menus: resources.offlineMenus })
            : { ok: true };
        let shellCached = false;
        if (owner && navigator.onLine) {
            const response = await fetch("/web", { credentials: "same-origin", cache: "no-store" });
            if (response.ok && response.headers.get("content-type")?.includes("text/html")) {
                const result = await postMessageAndWait(worker, {
                    type: "CACHE_SHELL",
                    owner,
                    html: await response.text(),
                });
                shellCached = !!result?.ok;
            }
        }
        return {
            registration,
            shellCached,
            assetsCached: assetsResult?.cached || 0,
            assetFailures: assetsResult?.failures || [],
            userFailures: userResult?.failures || [],
            menuFailure: menuResult?.ok === false ? menuResult.error || "Les menus hors ligne n'ont pas pu être enregistrés." : null,
        };
    } catch (error) {
        console.warn("Could not prepare the Odoo offline service worker.", error);
        return null;
    }
}
