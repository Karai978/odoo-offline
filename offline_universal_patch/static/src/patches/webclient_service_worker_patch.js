/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { WebClient } from "@web/webclient/webclient";

import { getOfflineRuntime } from "../services/runtime";

const OFFLINE_WORKER_PATH = "/offline_universal_patch/service_worker.js";

function isOfflineWorker(worker) {
    if (!worker) return false;
    try {
        return new URL(worker.scriptURL).pathname === OFFLINE_WORKER_PATH;
    } catch {
        return false;
    }
}

patch(WebClient.prototype, {
    registerServiceWorker() {
        const runtime = getOfflineRuntime();
        if (!runtime) return super.registerServiceWorker(...arguments);
        const fallback = () => super.registerServiceWorker(...arguments);
        Promise.resolve(runtime.serviceWorkerPromise).then(async (result) => {
            const registration = result?.registration || await navigator.serviceWorker?.getRegistration("/web");
            if (!isOfflineWorker(registration?.active)) fallback();
        }).catch(fallback);
    },
});
