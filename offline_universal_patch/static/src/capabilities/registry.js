/** @odoo-module **/

const capabilities = new Map();

function capabilityKey(model, method) {
    return `${model}.${method}`;
}

export function registerOfflineMethod(model, method, handler, options = {}) {
    if (typeof model !== "string" || typeof method !== "string" || typeof handler !== "function") {
        throw new TypeError("registerOfflineMethod requires a model, method and handler function.");
    }
    const key = capabilityKey(model, method);
    if (capabilities.has(key) && !options.replace) {
        throw new Error(`Offline method already registered: ${key}`);
    }
    capabilities.set(key, {
        model,
        method,
        handler,
        label: options.label || key,
        dependencies: options.dependencies || [],
        version: options.version || 1,
        sideEffects: options.sideEffects || "deferred",
    });
    return () => capabilities.delete(key);
}

export function getOfflineMethod(model, method) {
    return capabilities.get(capabilityKey(model, method)) || null;
}

export function listOfflineMethods() {
    return [...capabilities.values()].map(({ handler, ...metadata }) => metadata);
}
