/** @odoo-module **/

import { registry } from "@web/core/registry";

const listeners = new Set();
let online = typeof navigator === "undefined" ? true : navigator.onLine;
let cause = "browser";

function publish(nextOnline, nextCause) {
    online = !!nextOnline;
    cause = nextCause || "unknown";
    for (const listener of listeners) {
        listener({ online, cause });
    }
}

export function reportConnectionStatus(nextOnline, nextCause) {
    publish(nextOnline, nextCause);
}

export const offlineStatusService = {
    start() {
        const onOnline = () => publish(true, "browser");
        const onOffline = () => publish(false, "browser");
        window.addEventListener("online", onOnline);
        window.addEventListener("offline", onOffline);

        return {
            get isOnline() {
                return online;
            },
            get cause() {
                return cause;
            },
            subscribe(listener) {
                listeners.add(listener);
                listener({ online, cause });
                return () => listeners.delete(listener);
            },
        };
    },
};

registry.category("services").add("offline_webclient_17.status", offlineStatusService);
