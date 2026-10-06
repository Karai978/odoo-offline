/** @odoo-module **/

const DATABASE_NAME = "offline_webclient_17";
const DATABASE_VERSION = 1;
const STORE_NAME = "rpc_reads";

let databasePromise;

function openDatabase() {
    if (typeof indexedDB === "undefined") {
        return Promise.resolve(null);
    }
    if (!databasePromise) {
        databasePromise = new Promise((resolve) => {
            const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
            request.onupgradeneeded = () => {
                const database = request.result;
                if (!database.objectStoreNames.contains(STORE_NAME)) {
                    database.createObjectStore(STORE_NAME, { keyPath: "key" });
                }
            };
            request.onsuccess = () => {
                request.result.onversionchange = () => request.result.close();
                resolve(request.result);
            };
            request.onerror = () => resolve(null);
            request.onblocked = () => resolve(null);
        }).catch(() => {
            databasePromise = null;
            return null;
        });
    }
    return databasePromise;
}

function canonicalize(value) {
    if (value === undefined) {
        return { __offline_undefined__: true };
    }
    if (value instanceof Date) {
        return { __offline_date__: value.toISOString() };
    }
    if (Array.isArray(value)) {
        return value.map(canonicalize);
    }
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .map((key) => [key, canonicalize(value[key])])
        );
    }
    return value;
}

export function makeReadCacheKey(orm, model, method, args, kwargs) {
    const user = orm.user || {};
    const userContext = user.context || {};
    const context = { ...userContext, ...(kwargs?.context || {}) };
    return JSON.stringify(
        canonicalize({
            schema: 1,
            database: user.db?.uuid || user.db?.name || "unknown",
            userId: user.userId ?? context.uid ?? "unknown",
            model,
            method,
            args,
            kwargs: { ...(kwargs || {}), context },
        })
    );
}

export async function getCachedRead(key) {
    const database = await openDatabase();
    if (!database) {
        return { found: false };
    }
    return new Promise((resolve) => {
        try {
            const transaction = database.transaction(STORE_NAME, "readonly");
            const request = transaction.objectStore(STORE_NAME).get(key);
            request.onsuccess = () => {
                const record = request.result;
                resolve(record ? { found: true, value: record.value, savedAt: record.savedAt } : { found: false });
            };
            request.onerror = () => resolve({ found: false });
            transaction.onabort = () => resolve({ found: false });
        } catch (error) {
            resolve({ found: false });
        }
    });
}

export async function saveCachedRead(key, model, value) {
    const database = await openDatabase();
    if (!database) return;
    await new Promise((resolve) => {
        try {
            const transaction = database.transaction(STORE_NAME, "readwrite");
            transaction.objectStore(STORE_NAME).put({ key, model, value, savedAt: Date.now() });
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => resolve();
            transaction.onabort = () => resolve();
        } catch (error) {
            resolve();
        }
    });
}

export async function clearCachedReads() {
    const database = await openDatabase();
    if (!database) return;
    await new Promise((resolve) => {
        try {
            const transaction = database.transaction(STORE_NAME, "readwrite");
            transaction.objectStore(STORE_NAME).clear();
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => resolve();
            transaction.onabort = () => resolve();
        } catch (error) {
            resolve();
        }
    });
}
