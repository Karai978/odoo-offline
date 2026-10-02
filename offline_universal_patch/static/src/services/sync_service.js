/** @odoo-module **/

const PAGE_SIZE = 200;
const OPERATION_BATCH_SIZE = 1;

function emitProgress(runtime, detail) {
    runtime.env.bus.trigger("OFFLINE_UNIVERSAL:PROGRESS", detail);
}

function assertNativeViews(manifest, model, requestedViews) {
    const views = manifest?.native_views?.views || {};
    const missing = requestedViews.map(([id, type]) => [id, type === "tree" ? "list" : type])
        .filter(([id, type]) => !views[type] || (id && Number(id) !== Number(views[type].id)))
        .map(([id, type]) => `${type}${id ? `(${id})` : ""}`);
    if (missing.length) throw new Error(`${model}: vues natives non préparées — ${missing.join(", ")}.`);
}

async function requestStoragePersistence() {
    try {
        if (navigator.storage?.persist) await navigator.storage.persist();
        return await navigator.storage?.estimate?.();
    } catch {
        return null;
    }
}

export async function prepareOffline(runtime) {
    if (!navigator.onLine) throw new Error("La préparation complète nécessite une connexion à Odoo.");
    const deviceUuid = await runtime.getDeviceUuid();
    await runtime.database.putMeta("offline_ready", false);
    emitProgress(runtime, { phase: "bootstrap", message: "Lecture des apps, modèles et droits…" });

    const catalog = await runtime.rpc("/offline_universal_patch/bootstrap", { device_uuid: deviceUuid });
    if (!catalog?.models || !Array.isArray(catalog.models)) {
        throw new Error("Le serveur n'a pas renvoyé un catalogue de modèles valide.");
    }
    await runtime.database.putMeta("catalog", catalog);
    await runtime.database.putMeta("cache_owner", {
        database: catalog.database,
        user_id: catalog.user?.id,
        login: catalog.user?.login,
    });

    if ((await runtime.database.listOutbox("pending")).length) await runtime.sync();
    const blockers = [];
    for (const status of ["pending", "conflict", "error"]) {
        blockers.push(...await runtime.database.listOutbox(status));
    }
    if (blockers.length) {
        throw new Error("Synchronisez ou résolvez les opérations en attente avant de reconstruire le cache offline.");
    }
    await runtime.database.clearSnapshotStores();

    let cursor = Number(catalog.cursor || 0);
    await runtime.database.putMeta("change_cursor", cursor);

    const models = catalog.models.filter((model) => model.access?.read);
    const modelNames = new Set(models.map((item) => item.model));
    const failures = [];
    let modelIndex = 0;
    for (const modelInfo of models) {
        modelIndex++;
        const model = modelInfo.model;
        emitProgress(runtime, {
            phase: "metadata",
            current: modelIndex,
            total: models.length,
            model,
            message: `Métadonnées ${modelIndex}/${models.length} : ${model}`,
        });
        try {
            const manifest = await runtime.rpc("/offline_universal_patch/model_manifest", { model });
            if (manifest?.model !== model || !manifest.native_views?.models || !manifest.native_views?.views) {
                throw new Error("Le manifeste des vues ou des champs est incomplet.");
            }
            assertNativeViews(manifest, model, [[false, "list"], [false, "form"], [false, "search"]]);
            await runtime.database.putManifest(manifest);
        } catch (error) {
            failures.push({ model, phase: "metadata", error: error.message });
            continue;
        }

        const actionEntries = Object.entries(catalog.actions || {}).filter(([, action]) => action.res_model === model);
        for (const [actionId, action] of actionEntries) {
            const actionViews = (action.views || []).filter(([, viewType]) => ["list", "tree", "form", "kanban", "search"].includes(viewType));
            if (action.search_view_id?.[0]) actionViews.push([action.search_view_id[0], "search"]);
            if (!actionViews.length) continue;
            try {
                const actionManifest = await runtime.rpc("/offline_universal_patch/model_manifest", {
                    model,
                    action_id: Number(actionId),
                    views: actionViews,
                    context: { lang: catalog.user?.lang },
                });
                if (actionManifest?.model !== model || !actionManifest.native_views?.views) {
                    throw new Error("Le manifeste des vues de l'action est incomplet.");
                }
                assertNativeViews(actionManifest, model, actionViews);
                await runtime.database.putManifest(actionManifest);
            } catch (error) {
                failures.push({ model, action_id: actionId, phase: "action_views", error: error.message });
            }
        }

        let offset = 0;
        let total = null;
        try {
            do {
                emitProgress(runtime, {
                    phase: "snapshot",
                    model,
                    offset,
                    total,
                    message: `Données ${model} : ${offset}${total === null ? "" : `/${total}`}`,
                });
                const page = await runtime.rpc("/offline_universal_patch/snapshot", {
                    model,
                    offset,
                    limit: PAGE_SIZE,
                    include_binary: true,
                });
                if (page?.model !== model || !Number.isInteger(page.total) || !Array.isArray(page.records)) {
                    throw new Error("Le serveur a renvoyé une page de données invalide.");
                }
                total = page.total;
                await runtime.database.putRecords(model, page.records);
                if (typeof page.done !== "boolean") throw new Error("Le serveur n'a pas confirmé l'état de pagination.");
                if (page.done) break;
                if (!Number.isInteger(page.next_offset) || page.next_offset <= offset) {
                    throw new Error("Le serveur a renvoyé un curseur de pagination invalide.");
                }
                offset = page.next_offset;
            } while (true);
        } catch (error) {
            failures.push({ model, phase: "snapshot", error: error.message });
        }
    }

    if (failures.length) {
        await runtime.database.putMeta("offline_ready", false);
        await runtime.database.putMeta("offline_prepare_failures", failures);
        emitProgress(runtime, {
            phase: "failed",
            failures,
            message: `Préparation incomplète : ${failures.length} erreur(s).`,
        });
        throw new Error(`Préparation incomplète pour ${failures.length} élément(s). Consultez le panneau offline.`);
    }

    // Apply changes that occurred while the full snapshots were being built.
    let accessChangedDuringSnapshot = false;
    let hasMore = true;
    while (hasMore) {
        const delta = await runtime.rpc("/offline_universal_patch/changes", {
            device_uuid: deviceUuid,
            cursor,
            limit: 200,
        });
        const changes = delta.changes || [];
        accessChangedDuringSnapshot ||= changes.some((change) => change.operation === "purge_model" && modelNames.has(change.model));
        await applyChanges(runtime, changes);
        cursor = Number(delta.cursor || cursor);
        hasMore = !!delta.has_more;
    }
    if (accessChangedDuringSnapshot) {
        await runtime.database.putMeta("offline_ready", false);
        throw new Error("Les droits ont changé pendant la préparation ; relancez le téléchargement complet.");
    }

    await runtime.database.putMeta("change_cursor", cursor);
    await runtime.database.putMeta("offline_prepare_failures", []);
    emitProgress(runtime, { phase: "service_worker", message: "Vérification du shell et des assets Odoo…" });
    await runtime.ensureOfflineShell();
    const storage = await requestStoragePersistence();
    await runtime.database.putMeta("storage_estimate", storage || null);
    await runtime.database.putMeta("prepared_at", new Date().toISOString());
    await runtime.database.putMeta("offline_ready", true);
    emitProgress(runtime, { phase: "ready", message: "Cache de données préparé ; les méthodes métier nécessitent leurs capacités offline enregistrées." });
    return { modelCount: models.length, cursor, storage };
}

export async function applyChanges(runtime, changes) {
    const protectedRecords = new Set();
    for (const status of ["pending", "conflict", "error"]) {
        for (const operation of await runtime.database.listOutbox(status)) {
            const ids = operation.local_ids || (operation.local_id !== undefined ? [operation.local_id] : []);
            if (!ids.length) {
                const firstArg = operation.args?.[0];
                if (Array.isArray(firstArg)) ids.push(...firstArg.filter(Number.isInteger));
                else if (Number.isInteger(firstArg)) ids.push(firstArg);
            }
            for (const id of ids) protectedRecords.add(`${operation.model}:${id}`);
        }
    }
    for (const change of changes) {
        if (change.operation === "delete") {
            if (!protectedRecords.has(`${change.model}:${change.id}`)) {
                await runtime.database.deleteRecord(change.model, change.id);
            }
        } else if (change.operation === "purge_model") {
            await runtime.database.clearModel(change.model);
            await runtime.database.putMeta("offline_ready", false);
        } else if (change.operation === "upsert" && change.record) {
            if (!protectedRecords.has(`${change.model}:${change.record.id}`)) {
                await runtime.database.putRecord(change.model, change.record);
            }
        }
    }
}

export async function syncNow(runtime) {
    if (!navigator.onLine) throw new Error("Aucune connexion réseau.");
    const deviceUuid = await runtime.getDeviceUuid();
    const pending = await runtime.database.listOutbox("pending");
    let completed = 0;
    let conflictCount = 0;
    let errorCount = 0;

    for (let start = 0; start < pending.length; start += OPERATION_BATCH_SIZE) {
        const batch = pending.slice(start, start + OPERATION_BATCH_SIZE);
        const response = await runtime.rpc("/offline_universal_patch/operations", {
            device_uuid: deviceUuid,
            operations: batch,
        });
        const results = response.results || [];
        let stopAfterThisOperation = false;
        for (const result of results) {
            if (!result.operation_uuid) continue;
            if (result.status === "done") {
                await runtime.database.updateOutbox(result.operation_uuid, {
                    status: "sent",
                    server_result: result.result,
                    synced_at: new Date().toISOString(),
                    error: null,
                });
                for (const mapping of result.mapped_ids || []) {
                    if (Number.isInteger(mapping.local_id) && Number.isInteger(mapping.server_id)) {
                        const operation = batch.find((item) => item.operation_uuid === result.operation_uuid);
                        await runtime.database.replaceId(operation?.model, mapping.local_id, mapping.server_id);
                    }
                }
                completed++;
            } else if (result.status === "conflict") {
                await runtime.database.updateOutbox(result.operation_uuid, {
                    status: "conflict",
                    server_result: result.result,
                    error: "Conflit de synchronisation ; arbitrage requis.",
                });
                conflictCount++;
                stopAfterThisOperation = true;
            } else {
                await runtime.database.updateOutbox(result.operation_uuid, {
                    status: "error",
                    error: result.error || "Erreur de synchronisation inconnue.",
                });
                errorCount++;
                stopAfterThisOperation = true;
            }
        }
        if (stopAfterThisOperation) break;
    }

    let cursor = Number((await runtime.database.getMeta("change_cursor")) || 0);
    let hasMore = true;
    while (hasMore) {
        const delta = await runtime.rpc("/offline_universal_patch/changes", {
            device_uuid: deviceUuid,
            cursor,
            limit: 200,
        });
        await applyChanges(runtime, delta.changes || []);
        cursor = Number(delta.cursor || cursor);
        hasMore = !!delta.has_more;
    }
    await runtime.database.putMeta("change_cursor", cursor);
    const summary = { completed, conflictCount, errorCount, pendingCount: (await runtime.database.listOutbox("pending")).length };
    runtime.env.bus.trigger("OFFLINE_UNIVERSAL:SYNCED", summary);
    return summary;
}
