/** @odoo-module **/

import { registry } from "@web/core/registry";
import { session } from "@web/session";

import { openOfflineDatabase, newUuid } from "../database/database";
import { OfflineOrmEngine, OfflineUnsupportedError } from "./offline_orm";
import { prepareOffline, syncNow } from "./sync_service";
import { registerServiceWorker } from "../service_worker/register";
import { stableStringify } from "../query/domain";

let currentRuntime = null;
const READ_METHODS = new Set([
    "read", "web_read", "search", "search_read", "web_search_read", "search_count",
    "read_group", "web_read_group", "read_progress_bar", "name_get", "name_search", "fields_get",
    "get_views", "get_view", "check_access_rights", "check_access_rule",
    "get_external_id", "get_metadata", "onchange",
]);

export function canonicalRoute(route) {
    const pathname = String(route || "").split("?")[0];
    if (pathname.startsWith("/web/webclient/load_menus/")) return "/web/webclient/load_menus/:unique";
    return pathname;
}

export function rpcCacheKey(route, params) {
    return stableStringify([canonicalRoute(route), params || {}]);
}

export function parseModelCall(route, params = {}) {
    const path = String(route || "").split("?")[0];
    const match = path.match(/^\/web\/dataset\/call_kw\/([^/]+)\/([^/]+)$/);
    if (match) {
        return { model: decodeURIComponent(match[1]), method: decodeURIComponent(match[2]), args: params.args || [], kwargs: params.kwargs || {} };
    }
    if (path === "/web/dataset/call_kw" && params.model && params.method) {
        return { model: params.model, method: params.method, args: params.args || [], kwargs: params.kwargs || {} };
    }
    return null;
}

export function parseButtonCall(route, params = {}) {
    if (String(route || "").split("?")[0] !== "/web/dataset/call_button") return null;
    if (!params.model || !params.method) return null;
    return { model: params.model, method: params.method, args: params.args || [], kwargs: params.kwargs || {} };
}

export function parseResequence(route, params = {}) {
    if (String(route || "").split("?")[0] !== "/web/dataset/resequence" || !params.model) return null;
    return {
        model: params.model,
        method: "resequence",
        args: [params.ids || []],
        kwargs: { field: params.field || "sequence", offset: params.offset || 0, context: params.context || {} },
    };
}

export function isReadOnlyCall(route, params = {}) {
    const call = parseModelCall(route, params);
    if (call) return READ_METHODS.has(call.method);
    const path = canonicalRoute(route);
    return [
        "/web/action/load",
        "/web/dataset/search_read",
        "/web/webclient/load_menus/:unique",
        "/web/webclient/version_info",
        "/web/session/get_session_info",
    ].includes(path);
}

export function isTransportError(error) {
    return !!error && (
        error.name === "ConnectionLostError" ||
        error.name === "ConnectionAbortedError" ||
        error.name === "TypeError" ||
        error.status === 0 ||
        error.status === 502
    );
}

export class OfflineRuntime {
    constructor({ env, rpc, user, database }) {
        this.env = env;
        this.rpc = rpc;
        this.user = user;
        this.database = database;
        this.transportOffline = false;
        this.serviceWorkerPromise = Promise.resolve(null);
        this.syncPromise = null;
        this.engine = new OfflineOrmEngine({ database, user, runtime: this });
        this._onOnline = () => {
            this.transportOffline = false;
            this.env.bus.trigger("OFFLINE_UNIVERSAL:CONNECTIVITY", { online: true });
            this.database.getMeta("offline_ready").then((ready) => {
                if (ready) this.sync().catch((error) => console.warn("Offline sync retry failed", error));
            });
        };
        this._onOffline = () => {
            this.env.bus.trigger("OFFLINE_UNIVERSAL:CONNECTIVITY", { online: false });
        };
    }

    getOwner() {
        return `${this.user.db?.name || session.db || "database"}:${this.user.userId || session.uid || "unknown"}`;
    }

    getWorkerResources() {
        const lang = this.user.lang || session.user_context?.lang || "en_US";
        const hashes = session.cache_hashes || {};
        const publicUrls = [];
        const userUrls = [];
        if (hashes.translations) {
            const base = session.translationURL || "/web/webclient/translations";
            publicUrls.push(`${base}/${hashes.translations}?lang=${encodeURIComponent(lang)}`);
        }
        if (hashes.load_menus) {
            const menuBase = `/web/webclient/load_menus/${hashes.load_menus}`;
            userUrls.push(menuBase, `${menuBase}?lang=${encodeURIComponent(lang)}`);
        }
        return { publicUrls, userUrls };
    }

    async initialize() {
        window.addEventListener("online", this._onOnline);
        window.addEventListener("offline", this._onOffline);
        const owner = this.getOwner();
        navigator.serviceWorker?.controller?.postMessage({ type: "SET_OWNER", owner });
        if (navigator.serviceWorker) {
            this.serviceWorkerPromise = registerServiceWorker(owner, this.getWorkerResources()).catch((error) => {
                console.warn("Offline service worker registration failed", error);
                return null;
            });
        }
    }

    async ensureOfflineShell() {
        const result = await registerServiceWorker(this.getOwner(), this.getWorkerResources());
        if (!result?.registration?.active || !result.shellCached) {
            throw new Error("Le shell Odoo n'a pas pu être préparé pour le rechargement hors ligne. Vérifiez HTTPS et le service worker.");
        }
        if (result.assetFailures?.length) {
            throw new Error(`${result.assetFailures.length} asset(s) Odoo n'ont pas pu être mis en cache.`);
        }
        if (result.userFailures?.length) {
            throw new Error(`${result.userFailures.length} ressource(s) utilisateur Odoo n'ont pas pu être mises en cache.`);
        }
        this.serviceWorkerPromise = Promise.resolve(result);
        return result;
    }

    isOffline() {
        return !navigator.onLine || this.transportOffline;
    }

    markTransportOffline() {
        this.transportOffline = true;
        this.env.bus.trigger("OFFLINE_UNIVERSAL:CONNECTIVITY", { online: false, reason: "transport" });
    }

    async getDeviceUuid() {
        let deviceUuid = await this.database.getMeta("device_uuid");
        if (!deviceUuid) {
            deviceUuid = newUuid();
            await this.database.putMeta("device_uuid", deviceUuid);
        }
        return deviceUuid;
    }

    async prepare() {
        const result = await prepareOffline(this);
        navigator.serviceWorker?.controller?.postMessage({ type: "SET_OWNER", owner: this.getOwner() });
        return result;
    }

    sync() {
        if (!this.syncPromise) {
            this.syncPromise = syncNow(this).finally(() => { this.syncPromise = null; });
        }
        return this.syncPromise;
    }

    async getSummary() {
        const statuses = ["pending", "conflict", "error"];
        const summary = {};
        for (const status of statuses) summary[status] = (await this.database.listOutbox(status)).length;
        summary.ready = !!(await this.database.getMeta("offline_ready"));
        summary.online = !this.isOffline();
        summary.preparedAt = await this.database.getMeta("prepared_at");
        return summary;
    }

    async handleOfflineRpc(route, params = {}) {
        if (String(route).startsWith("/offline_universal_patch/")) {
            throw new OfflineUnsupportedError("Le serveur Odoo n'est pas joignable ; cette route nécessite une connexion.");
        }
        const routeKey = canonicalRoute(route);
        if (routeKey === "/web/webclient/load_menus/:unique") {
            const catalog = await this.database.getMeta("catalog");
            if (catalog?.menus) return catalog.menus;
        }
        if (routeKey === "/web/session/get_session_info") {
            return { ...session };
        }
        if (routeKey === "/web/webclient/version_info") {
            return session.server_version_info || { server_version: "17.0", server_serie: "17.0" };
        }
        if (routeKey === "/web/action/load") {
            const catalog = await this.database.getMeta("catalog");
            const action = catalog?.actions?.[String(params.action_id)];
            if (action) {
                const result = { ...action };
                if (params.additional_context && result.context && typeof result.context === "object") {
                    result.context = { ...result.context, ...params.additional_context };
                }
                return result;
            }
        }
        const button = parseButtonCall(route, params);
        const resequence = parseResequence(route, params);
        if (resequence) {
            return this.engine.call(resequence.model, resequence.method, resequence.args, resequence.kwargs);
        }
        if (button) {
            try {
                return await this.engine.localButton(button.model, button.method, button.args, button.kwargs);
            } catch (error) {
                const cached = await this.database.getCachedRpc(rpcCacheKey(route, params));
                if (cached !== undefined) return cached;
                throw error;
            }
        }
        const call = parseModelCall(route, params);
        if (call) {
            try {
                return await this.engine.call(call.model, call.method, call.args, call.kwargs);
            } catch (error) {
                const cached = await this.database.getCachedRpc(rpcCacheKey(route, params));
                if (cached !== undefined) return cached;
                throw error;
            }
        }
        const cached = await this.database.getCachedRpc(rpcCacheKey(route, params));
        if (cached !== undefined) return cached;
        throw new OfflineUnsupportedError(`L'appel Odoo ${canonicalRoute(route)} n'est pas disponible hors ligne.`);
    }

    async cacheRpcResponse(route, params, result) {
        if (!isReadOnlyCall(route, params)) return;
        try {
            await this.database.cacheRpc(rpcCacheKey(route, params), result);
            const call = parseModelCall(route, params);
            if (!call) return;
            const records = Array.isArray(result)
                ? result
                : Array.isArray(result?.records)
                    ? result.records
                    : [];
            if (records.length && records.every((record) => record && Number.isInteger(record.id))) {
                await this.database.putRecords(call.model, records);
            }
        } catch (error) {
            console.warn("Could not cache Odoo response for offline use", error);
        }
    }

    async executeOnlineMutation(route, params, rawRpc, settings = {}) {
        const button = parseButtonCall(route, params);
        const resequence = parseResequence(route, params);
        const call = button || resequence || parseModelCall(route, params);
        if (!call) return rawRpc(route, params, settings);
        const operation = {
            operation_uuid: newUuid(),
            model: call.model,
            method: call.method,
            args: call.args,
            kwargs: call.kwargs,
            expected_write_dates: {},
        };
        let deviceUuid;
        try {
            deviceUuid = await this.getDeviceUuid();
        } catch (error) {
            console.warn("Offline idempotency is unavailable; sending the native Odoo request.", error);
            return rawRpc(route, params, settings);
        }
        const requestParams = {
            device_uuid: deviceUuid,
            operation,
            route_kind: button ? "button" : resequence ? "resequence" : "call_kw",
        };
        const request = rawRpc("/offline_universal_patch/execute", requestParams, settings);
        const promise = request.then(async (result) => {
            try {
                await this.engine.mirrorOnlineResult(call.model, call.method, call.args, result);
            } catch (error) {
                console.warn("Could not update the offline mirror after an online mutation", error);
            }
            this.database.getMeta("offline_ready").then((ready) => {
                if (ready) this.sync().catch((error) => console.warn("Could not refresh the offline mirror", error));
            }).catch((error) => console.warn("Could not refresh offline state", error));
            return result;
        }).catch(async (error) => {
            if (!isTransportError(error)) throw error;
            this.markTransportOffline();
            if (button) {
                return this.engine.localButton(call.model, call.method, call.args, call.kwargs, operation.operation_uuid);
            }
            return this.engine.call(call.model, call.method, call.args, call.kwargs, operation.operation_uuid);
        });
        if (request.abort) promise.abort = request.abort.bind(request);
        return promise;
    }
}

export function getOfflineRuntime() {
    return currentRuntime;
}

export const offlineUniversalService = {
    dependencies: ["rpc", "user"],
    async start(env, { rpc, user }) {
        try {
            const databaseName = user.db?.name || session.db || "database";
            const userId = user.userId || session.uid || session.user_id;
            const database = await openOfflineDatabase(databaseName, userId);
            currentRuntime = new OfflineRuntime({ env, rpc, user, database });
            await currentRuntime.initialize();
            return currentRuntime;
        } catch (error) {
            currentRuntime = null;
            console.warn("Offline storage is unavailable; Odoo will continue online.", error);
            return {
                async getSummary() {
                    return { ready: false, online: navigator.onLine, pending: 0, conflict: 0, error: 0, preparedAt: null };
                },
                async prepare() { throw new Error(`Stockage offline indisponible : ${error.message}`); },
                async sync() { throw new Error(`Stockage offline indisponible : ${error.message}`); },
            };
        }
    },
};

registry.category("services").add("offline_universal", offlineUniversalService, { sequence: 5 });
