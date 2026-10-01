/**
 * core/record_cache.js
 * Manage the local cache of complete records (all fields of a business object)
 * to enable offline editing of forms that have already been viewed
 * at least once while online
 */

import { db } from "./orm_service.js";

/**
 * Downloads the complete data for a record from Odoo
 * and updates the local db.record_cache
 */
export async function fetchAndStoreRecord(modelName, recordId, apiKey, baseUrl) {
  const response = await fetch(
    `${baseUrl}/offline_sync/read_record?model=${encodeURIComponent(modelName)}&id=${recordId}`,
    { headers: { Authorization: `Bearer ${apiKey}` } }
  );
  if (!response.ok) throw new Error(`Erreur lecture enregistrement: ${response.status}`);

  const data = await response.json();
  await db.record_cache.put({
    model: modelName,
    record_id: parseInt(recordId),
    data: data.record,
    updated_at: new Date().toISOString(),
  });
  return data.record;
}

/**
 * Searches for a record in the Dexie cache.
 * Tests the key as both a String and a Number to account for
 * IndexedDB type inconsistencies.
 */
export async function getCachedRecord(modelName, recordId) {
  // 1. Attempt with the original ID (as is)
  let entry = await db.record_cache.get([modelName, recordId]);
  if (entry) return entry.data;

  // 2. Attempt to force conversion to an integer if it is a valid number
  const numericId = parseInt(recordId, 10);
  if (!isNaN(numericId)) {
    entry = await db.record_cache.get([modelName, numericId]);
    if (entry) return entry.data;
  }

  // 3. Attempt by converting to a pure String
  entry = await db.record_cache.get([modelName, String(recordId)]);
  if (entry) return entry.data;

  return null;
}

/**
 * Retrieves a record intelligently: prioritizes the server if online, 
 * otherwise the local cache, with a safe fallback to prevent crashes.
 */
export async function getRecordSmart(modelName, recordId, apiKey, baseUrl) {
  if (!navigator.onLine) {
    const cached = await getCachedRecord(modelName, recordId);
    if (!cached) {
      console.warn(`[Offline] Enregistrement ${modelName} ID ${recordId} non trouvé en cache.`);
      return { id: recordId, display_name: "Non disponible hors-ligne" };
    }
    return cached;
  }
  try {
    return await fetchAndStoreRecord(modelName, recordId, apiKey, baseUrl);
  } catch (err) {
    console.warn("Fetch de l'enregistrement échoué, tentative depuis le cache local...", err);
    const cached = await getCachedRecord(modelName, recordId);
    if (!cached) {
      return { id: recordId, display_name: "Non disponible hors-ligne" };
    }
    return cached;
  }
}

/**
 * Fusionne de nouvelles valeurs dans l'enregistrement caché pour
 * modelName/recordId (crée l'entrée si elle n'existe pas encore — un
 * enregistrement créé hors ligne n'a pas de snapshot préalable).
 */
export async function upsertLocalRecord(modelName, recordId, values) {
  const existing = await db.record_cache.get([modelName, recordId]);
  const merged = { ...(existing ? existing.data : {}), ...values, id: recordId };
  await db.record_cache.put({
    model: modelName,
    record_id: recordId,
    data: merged,
    updated_at: new Date().toISOString(),
  });
  return merged;
}

/**
 * Renomme la clé d'un enregistrement caché (ex. ID temporaire
 * "local:<uuid>" -> ID Odoo réel) une fois que le serveur l'a attribué,
 * après une synchronisation réussie.
 */
export async function replaceRecordId(modelName, oldId, newId) {
  const existing = await db.record_cache.get([modelName, oldId]);
  if (!existing) return;
  await db.record_cache.delete([modelName, oldId]);
  await db.record_cache.put({
    model: modelName,
    record_id: newId,
    data: { ...existing.data, id: newId },
    updated_at: new Date().toISOString(),
  });
}