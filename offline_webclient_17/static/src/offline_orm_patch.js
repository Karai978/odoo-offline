/** @odoo-module **/

import { ConnectionLostError } from "@web/core/network/rpc_service";
import { ORM } from "@web/core/orm_service";
import { patch } from "@web/core/utils/patch";

import {
    clearCachedReads,
    getCachedRead,
    makeReadCacheKey,
    saveCachedRead,
} from "./offline_call_cache";
import { reportConnectionStatus } from "./offline_status_service";

// Cache only read-shaped calls. Arbitrary Python methods and mutations must
// never be mistaken for cacheable reads or silently answered with old data.
const READ_METHODS = new Set([
    "fields_get",
    "get_views",
    "name_get",
    "name_search",
    "read",
    "read_group",
    "search",
    "search_count",
    "search_read",
    "web_read",
    "web_read_group",
    "web_search_read",
]);

const MUTATING_METHODS = new Set([
    "action_archive",
    "action_unarchive",
    "create",
    "unlink",
    "web_save",
    "write",
]);

patch(ORM.prototype, {
    call(model, method, args = [], kwargs = {}) {
        const isRead = READ_METHODS.has(method);
        const cacheKey = isRead ? makeReadCacheKey(this, model, method, args, kwargs) : null;
        const browserIsOffline = typeof navigator !== "undefined" && !navigator.onLine;

        if (isRead && browserIsOffline) {
            reportConnectionStatus(false, "browser");
            return getCachedRead(cacheKey).then((cached) => {
                if (cached.found) return cached.value;
                throw new ConnectionLostError(`/web/dataset/call_kw/${model}/${method}`);
            });
        }

        // Keep the native RPC promise contract, including its abort() method.
        const rpcPromise = super.call(model, method, args, kwargs);
        const handledPromise = rpcPromise.then(
            async (result) => {
                reportConnectionStatus(true, "rpc");
                if (isRead) {
                    await saveCachedRead(cacheKey, model, result);
                } else if (MUTATING_METHODS.has(method)) {
                    // Avoid serving a stale snapshot after an online mutation.
                    await clearCachedReads();
                }
                return result;
            },
            async (error) => {
                if (error instanceof ConnectionLostError) {
                    reportConnectionStatus(false, "rpc");
                    if (isRead) {
                        const cached = await getCachedRead(cacheKey);
                        if (cached.found) return cached.value;
                    }
                }
                throw error;
            }
        );
        if (typeof rpcPromise.abort === "function") {
            handledPromise.abort = (...abortArgs) => rpcPromise.abort(...abortArgs);
        }
        return handledPromise;
    },
});
