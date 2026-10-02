/** @odoo-module **/

import { rpcService } from "@web/core/network/rpc_service";
import { patch } from "@web/core/utils/patch";

import {
    getOfflineRuntime,
    isMutationCall,
    isReadOnlyCall,
    isTransportError,
    parseButtonCall,
    parseResequence,
    rpcCacheKey,
} from "../services/runtime";

function preserveAbort(source, target) {
    if (source?.abort) target.abort = source.abort.bind(source);
    return target;
}

patch(rpcService, {
    start(env) {
        const rawRpc = super.start(...arguments);
        return function offlineAwareRpc(route, params = {}, settings = {}) {
            const runtime = getOfflineRuntime();
            if (!runtime || String(route).startsWith("/offline_universal_patch/")) {
                return rawRpc(route, params, settings);
            }
            if (runtime.isOffline()) {
                return runtime.handleOfflineRpc(route, params, settings);
            }

            const button = parseButtonCall(route, params);
            const resequence = parseResequence(route, params);
            if (button || resequence || isMutationCall(route, params)) {
                return runtime.executeOnlineMutation(route, params, rawRpc, settings);
            }

            const request = rawRpc(route, params, settings);
            const promise = request.then(async (result) => {
                await runtime.cacheRpcResponse(route, params, result);
                return result;
            }).catch(async (error) => {
                if (!isTransportError(error)) throw error;
                runtime.markTransportOffline();
                try {
                    return await runtime.handleOfflineRpc(route, params, settings);
                } catch {
                    throw error;
                }
            });
            return preserveAbort(request, promise);
        };
    },
});
