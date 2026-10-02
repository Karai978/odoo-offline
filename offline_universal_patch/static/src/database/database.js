/** @odoo-module **/

const DATABASE_VERSION = 1;
const DB_PREFIX = "odoo_offline_universal_v1";

function requestPromise(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
    });
}

function transactionPromise(transaction) {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
        transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
    });
}

function encodeNamePart(value) {
    return encodeURIComponent(String(value || "unknown")).replaceAll("%", "_");
}

export function newUuid() {
    if (globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
        const random = Math.random() * 16 | 0;
        const value = char === "x" ? random : (random & 0x3) | 0x8;
        return value.toString(16);
    });
}

export class OfflineDatabase {
    constructor(databaseName, userId) {
        this.name = `${DB_PREFIX}_${encodeNamePart(databaseName)}_${encodeNamePart(userId)}`;
        this.databaseName = databaseName;
        this.userId = userId;
        this._dbPromise = null;
    }

    async open() {
        if (!globalThis.indexedDB) {
            throw new Error("Ce navigateur ne fournit pas IndexedDB ; mode hors ligne indisponible.");
        }
        if (!this._dbPromise) {
            this._dbPromise = new Promise((resolve, reject) => {
                const request = indexedDB.open(this.name, DATABASE_VERSION);
                request.onupgradeneeded = () => {
                    const db = request.result;
                    if (!db.objectStoreNames.contains("records")) {
                        const records = db.createObjectStore("records", { keyPath: ["model", "id"] });
                        records.createIndex("by_model", "model", { unique: false });
                        records.createIndex("by_model_write_date", ["model", "write_date"], { unique: false });
                    }
                    if (!db.objectStoreNames.contains("model_manifest")) {
                        db.createObjectStore("model_manifest", { keyPath: "key" });
                    }
                    if (!db.objectStoreNames.contains("metadata")) {
                        db.createObjectStore("metadata", { keyPath: "key" });
                    }
                    if (!db.objectStoreNames.contains("outbox")) {
                        const outbox = db.createObjectStore("outbox", { keyPath: "operation_uuid" });
                        outbox.createIndex("by_status", "status", { unique: false });
                        outbox.createIndex("by_created_at", "created_at", { unique: false });
                    }
                    if (!db.objectStoreNames.contains("rpc_cache")) {
                        const rpcCache = db.createObjectStore("rpc_cache", { keyPath: "key" });
                        rpcCache.createIndex("by_expiry", "expires_at", { unique: false });
                    }
                };
                request.onsuccess = () => {
                    const db = request.result;
                    db.onversionchange = () => db.close();
                    resolve(db);
                };
                request.onerror = () => reject(request.error || new Error("Could not open offline database"));
                request.onblocked = () => reject(new Error("Une autre page bloque la mise à niveau du cache offline."));
            });
        }
        return this._dbPromise;
    }

    async _run(storeNames, mode, callback) {
        const db = await this.open();
        const transaction = db.transaction(storeNames, mode);
        const done = transactionPromise(transaction);
        try {
            const result = await callback(transaction);
            await done;
            return result;
        } catch (error) {
            try { transaction.abort(); } catch { /* already completed */ }
            await done.catch(() => {});
            throw error;
        }
    }

    async getMeta(key) {
        return this._run(["metadata"], "readonly", async (tx) => {
            const entry = await requestPromise(tx.objectStore("metadata").get(key));
            return entry ? entry.value : undefined;
        });
    }

    async putMeta(key, value) {
        return this._run(["metadata"], "readwrite", (tx) =>
            requestPromise(tx.objectStore("metadata").put({ key, value, updated_at: new Date().toISOString() }))
        );
    }

    async putManifest(manifest) {
        const key = manifest.key || `${manifest.model}::default`;
        return this._run(["model_manifest"], "readwrite", (tx) =>
            requestPromise(tx.objectStore("model_manifest").put({ ...manifest, key, updated_at: new Date().toISOString() }))
        );
    }

    async getManifest(model, actionId = null) {
        return this._run(["model_manifest"], "readonly", async (tx) => {
            const store = tx.objectStore("model_manifest");
            const key = `${model}::${actionId || "default"}`;
            const specific = await requestPromise(store.get(key));
            if (specific || !actionId) return specific || null;
            return (await requestPromise(store.get(`${model}::default`))) || null;
        });
    }

    async putRecord(model, data, { local = false } = {}) {
        if (!data || data.id === undefined || data.id === null) {
            throw new Error(`Impossible de mettre en cache ${model} sans identifiant.`);
        }
        const record = {
            model,
            id: data.id,
            data: { ...data },
            local,
            updated_at: new Date().toISOString(),
            write_date: data.write_date || false,
        };
        await this._run(["records"], "readwrite", (tx) =>
            requestPromise(tx.objectStore("records").put(record))
        );
        return record.data;
    }

    async putRecords(model, records, options = {}) {
        if (!records?.length) return 0;
        await this._run(["records"], "readwrite", async (tx) => {
            const store = tx.objectStore("records");
            for (const data of records) {
                if (data?.id === undefined || data?.id === null) continue;
                store.put({
                    model,
                    id: data.id,
                    data: { ...data },
                    local: !!options.local,
                    updated_at: new Date().toISOString(),
                    write_date: data.write_date || false,
                });
            }
        });
        return records.length;
    }

    async getRecord(model, id) {
        return this._run(["records"], "readonly", async (tx) => {
            const entry = await requestPromise(tx.objectStore("records").get([model, id]));
            return entry?.data || null;
        });
    }

    async getRecords(model) {
        return this._run(["records"], "readonly", async (tx) => {
            const rows = await requestPromise(tx.objectStore("records").index("by_model").getAll(model));
            return rows.map((row) => row.data);
        });
    }

    async deleteRecord(model, id) {
        return this._run(["records"], "readwrite", (tx) =>
            requestPromise(tx.objectStore("records").delete([model, id]))
        );
    }

    async clearModel(model) {
        return this._run(["records"], "readwrite", async (tx) => {
            const store = tx.objectStore("records");
            const index = store.index("by_model");
            await new Promise((resolve, reject) => {
                const request = index.openCursor(IDBKeyRange.only(model));
                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                    const cursor = request.result;
                    if (!cursor) return resolve();
                    cursor.delete();
                    cursor.continue();
                };
            });
        });
    }

    async clearSnapshotStores() {
        return this._run(["records", "model_manifest", "rpc_cache"], "readwrite", (tx) => {
            tx.objectStore("records").clear();
            tx.objectStore("model_manifest").clear();
            tx.objectStore("rpc_cache").clear();
        });
    }

    async nextLocalId() {
        return this._run(["metadata"], "readwrite", async (tx) => {
            const store = tx.objectStore("metadata");
            const entry = await requestPromise(store.get("next_local_id"));
            const current = Number.isInteger(entry?.value) ? entry.value : -1;
            await requestPromise(store.put({ key: "next_local_id", value: current - 1 }));
            return current;
        });
    }

    async enqueue(operation) {
        const item = {
            ...operation,
            operation_uuid: operation.operation_uuid || newUuid(),
            status: "pending",
            created_at: operation.created_at || new Date().toISOString(),
            attempts: 0,
        };
        await this._run(["outbox"], "readwrite", (tx) =>
            requestPromise(tx.objectStore("outbox").put(item))
        );
        return item;
    }

    async listOutbox(status = "pending") {
        return this._run(["outbox"], "readonly", async (tx) => {
            const rows = await requestPromise(tx.objectStore("outbox").index("by_status").getAll(status));
            return rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
        });
    }

    async updateOutbox(operationUuid, values) {
        return this._run(["outbox"], "readwrite", async (tx) => {
            const store = tx.objectStore("outbox");
            const item = await requestPromise(store.get(operationUuid));
            if (item) await requestPromise(store.put({ ...item, ...values }));
            return !!item;
        });
    }

    async cacheRpc(key, result, ttlMs = 7 * 24 * 60 * 60 * 1000) {
        return this._run(["rpc_cache"], "readwrite", (tx) =>
            requestPromise(tx.objectStore("rpc_cache").put({
                key,
                result,
                expires_at: Date.now() + ttlMs,
                cached_at: new Date().toISOString(),
            }))
        );
    }

    async getCachedRpc(key) {
        return this._run(["rpc_cache"], "readwrite", async (tx) => {
            const store = tx.objectStore("rpc_cache");
            const entry = await requestPromise(store.get(key));
            if (entry && entry.expires_at > Date.now()) return entry.result;
            if (entry) store.delete(key);
            return undefined;
        });
    }

    async replaceId(model, localId, serverId) {
        if (!Number.isInteger(localId) || !Number.isInteger(serverId)) return;
        const replaceValue = (value) => {
            if (value === localId) return serverId;
            if (Array.isArray(value)) return value.map(replaceValue);
            if (value && typeof value === "object") {
                return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceValue(item)]));
            }
            return value;
        };
        await this._run(["records", "metadata"], "readwrite", async (tx) => {
            const records = tx.objectStore("records");
            await new Promise((resolve, reject) => {
                const cursorRequest = records.openCursor();
                cursorRequest.onerror = () => reject(cursorRequest.error);
                cursorRequest.onsuccess = () => {
                    const cursor = cursorRequest.result;
                    if (!cursor) return resolve();
                    const row = cursor.value;
                    if (row.model === model && row.id === localId) {
                        cursor.delete();
                        row.id = serverId;
                        row.data = { ...row.data, id: serverId };
                        row.local = false;
                        row.updated_at = new Date().toISOString();
                        records.put(row);
                    } else {
                        const nextData = replaceValue(row.data);
                        if (JSON.stringify(nextData) !== JSON.stringify(row.data)) {
                            row.data = nextData;
                            records.put(row);
                        }
                    }
                    cursor.continue();
                };
            });
            tx.objectStore("metadata").put({
                key: `id_map:${localId}`,
                value: { model, server_id: serverId },
                updated_at: new Date().toISOString(),
            });
        });
    }

    async getIdMap() {
        return this._run(["metadata"], "readonly", async (tx) => {
            const store = tx.objectStore("metadata");
            const rows = await requestPromise(store.getAll());
            const map = {};
            for (const row of rows) {
                if (row.key.startsWith("id_map:")) {
                    map[row.key.slice("id_map:".length)] = row.value.server_id;
                }
            }
            return map;
        });
    }
}

let currentDatabase = null;

export async function openOfflineDatabase(databaseName, userId) {
    const name = `${databaseName || "database"}:${userId || "anonymous"}`;
    if (!currentDatabase || currentDatabase.ownerKey !== name) {
        currentDatabase = new OfflineDatabase(databaseName, userId);
        currentDatabase.ownerKey = name;
    }
    await currentDatabase.open();
    return currentDatabase;
}

export function getOfflineDatabase() {
    return currentDatabase;
}
