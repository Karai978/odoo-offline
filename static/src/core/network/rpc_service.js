/**
 * core/network/rpc_service.js
 * Manages the queuing of user actions (creation, modification, deletion)
 * in a local IndexedDB database using Dexie, and sends them to the Odoo server as soon as
 * the network connection is restored. It also handles errors.
*/

import { CONFIG, getApiKey } from "../browser/session.js";
import { db } from "../orm_service.js";
import { clearLedgerForSyncUuid } from "../local_ledger.js";

/**
 * Generates a Universally Unique Identifier (UUID) on the client side 
 * without blocking the main thread. 
 * Works in all modern browsers.
 */
function generateUUID() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback: manually generates a v4 UUID
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Adds a new action to the local queue (sync_queue)
export async function queueAction(
  modelName,
  operation,
  payload,
  actionType = "generic",
  referenceWriteDate = null,
  referenceValues = null
) {
  const localUuid = generateUUID();
  await db.sync_queue.add({
    local_uuid: localUuid,
    model_name: modelName,
    operation,
    action_type: actionType,
    payload: JSON.stringify(payload),
    reference_write_date: referenceWriteDate,
    reference_values: referenceValues ? JSON.stringify(referenceValues) : null,
    status: "pending",
    created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
  });
  return localUuid;
}

/**
 * Queues a call to a public server-side method (e.g. a "type=object"
 * button such as action_confirm). Generic by design: modelName,
 * recordId, methodName, args and kwargs all come from the caller —
 * this function has no knowledge of any specific model or method.
 * No conflict detection applies here (unlike "write"), so no
 * referenceWriteDate/referenceValues are needed.
 */
export async function queueMethodCall(modelName, recordId, methodName, args = [], kwargs = {}) {
  const payload = { id: recordId, method: methodName, args, kwargs };
  return await queueAction(modelName, "call_method", payload);
}

// Attempts to send all pending actions (status "pending") to the server.
export async function syncPendingActions() {
  const pending = await db.sync_queue.where("status").equals("pending").toArray();
  if (pending.length === 0) return { synced: 0 };

  const actions = pending.map((a) => ({
    local_uuid: a.local_uuid,
    model_name: a.model_name,
    operation: a.operation,
    action_type: a.action_type,
    payload: a.payload,
    created_at: a.created_at,
    reference_write_date: a.reference_write_date || null,
    reference_values: a.reference_values || null,
  }));

  try {
    // Sends a POST request to the /offline sync/push endpoint of the Odoo API.
    const response = await fetch(`${CONFIG.ODOO_BASE_URL}/offline_sync/push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getApiKey()}`,
      },
      body: JSON.stringify({ actions }),
    });

    if (response.status === 401) {
      console.error("Clé API invalide — vérifie core/browser/session.js");
      return { synced: 0, error: "Authentification échouée" };
    }

    const data = await response.json();
    const results = data.results || [];

    const createdIds = {};
    const manualActions = {};

    for (const result of results) {
      const localEntry = pending.find((p) => p.local_uuid === result.local_uuid);
      if (!localEntry) continue;

      let mappedStatus = "error";
      if (result.status === "sent") {
        mappedStatus = "sent";
        if (localEntry.operation === "create" && result.odoo_record_id) {
          createdIds[localEntry.local_uuid] = result.odoo_record_id;
        }
        if (result.requires_manual_action && result.pending_action) {
          manualActions[localEntry.local_uuid] = result.pending_action;
        }
      } else if (result.status === "conflict") {
        // Distinct de "error" : ce n'est pas un échec technique, c'est un
        // état qui attend un arbitrage humain (voir conflict_panel.js).
        mappedStatus = "conflict";
      }

      await db.sync_queue.update(localEntry.id, {
        status: mappedStatus,
        error_message: result.error || null,
        conflict_details: result.conflicts ? JSON.stringify(result.conflicts) : null,
        requires_manual_action: result.requires_manual_action || false,
        pending_action: result.pending_action ? JSON.stringify(result.pending_action) : null,
      });

      // Une fois l'action réellement confirmée synchronisée, les deltas
      // locaux qu'elle a pu produire (voir rules/stock_rules.js ->
      // form_controller.js) sont désormais reflétés par le serveur --
      // on purge le ledger pour éviter de les additionner une seconde
      // fois par-dessus la valeur serveur au prochain rafraîchissement.
      if (mappedStatus === "sent") {
        await clearLedgerForSyncUuid(localEntry.local_uuid);
      }
    }

    return {
      synced: results.filter((r) => r.status === "sent").length,
      hasConflict: results.some((r) => r.status === "conflict"),
      hasError: results.some((r) => r.status === "error"),
      createdIds,
      manualActions,
    };
  } catch (err) {
    console.warn("Synchronisation impossible :", err);
    return { synced: 0, error: err.message };
  }
}

// Calculate the number of pending and error-state actions to populate
// the visual indicators (Navbar badges).
export async function getSyncQueueSummary() {
  const [pendingCount, errorCount] = await Promise.all([
    db.sync_queue.where("status").equals("pending").count(),
    db.sync_queue.where("status").equals("error").count(),
  ]);
  return { pending: pendingCount, error: errorCount };
}

// Retrieve all actions in error,
// sorted by date in descending order (most recent first)
export async function getSyncErrorEntries() {
  const rows = await db.sync_queue.where("status").equals("error").toArray();
  rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1)); // plus récent d'abord
  return rows;
}

// Retrieve all pending actions, sorted by date in descending order
export async function getSyncPendingEntries() {
  const rows = await db.sync_queue.where("status").equals("pending").toArray();
  rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return rows;
}

// Resets a specific failed action to the "pending" state 
// and restarts synchronization if the network is active.
export async function retrySyncAction(id) {
  await db.sync_queue.update(id, { status: "pending", error_message: null });
  if (navigator.onLine) {
    return await syncPendingActions();
  }
  return { synced: 0 };
}

// Bulk reset all failed actions
// to attempt a new resynchronization.
export async function retryAllSyncErrors() {
  const errors = await db.sync_queue.where("status").equals("error").toArray();
  await Promise.all(
    errors.map((e) => db.sync_queue.update(e.id, { status: "pending", error_message: null }))
  );
  if (navigator.onLine) {
    return await syncPendingActions();
  }
  return { synced: 0 };
}

// Permanently remove an action from the
// local IndexedDB queue (user cancellation)
export async function deleteSyncAction(id) {
  await db.sync_queue.delete(id);
}

/** Retrieves an entry from the local queue by its local_uuid. */
export async function getSyncQueueEntry(localUuid) {
  return await db.sync_queue.where("local_uuid").equals(localUuid).first();
}

/**
 * Allows modification of a record 
 * created offline, even before its initial upload to the server.
 */
export async function amendPendingCreate(localUuid, payload) {
  const entry = await getSyncQueueEntry(localUuid);
  if (!entry || entry.status !== "pending") return false;
  await db.sync_queue.update(entry.id, {
    payload: JSON.stringify(payload),
  });
  return true;
}

// Retrieve all actions currently in conflict, awaiting manual arbitration,
// sorted by date descending (most recent first).
export async function getCachedConflicts() {
  const rows = await db.sync_queue.where("status").equals("conflict").toArray();
  rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return rows.map((row) => ({
    ...row,
    conflicts: row.conflict_details ? JSON.parse(row.conflict_details) : [],
  }));
}

// Number of conflicts awaiting resolution — used for the navbar badge.
export async function getConflictCount() {
  return await db.sync_queue.where("status").equals("conflict").count();
}

// Sends the user's arbitration choice ("local" keeps their own value,
// "server" abandons the local change) to the backend, then updates the
// local queue entry to reflect the outcome.
export async function resolveConflict(localUuid, resolution, apiKey, baseUrl) {
  const response = await fetch(`${baseUrl}/offline_sync/resolve_conflict`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ local_uuid: localUuid, resolution }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || `Erreur résolution conflit: ${response.status}`);
  }

  const data = await response.json();

  const localEntry = await getSyncQueueEntry(localUuid);
  if (localEntry) {
    await db.sync_queue.update(localEntry.id, {
      status: data.status,
      has_conflict: false,
      conflict_details: null,
      error_message: data.error || null,
    });
  }

  return data;
}