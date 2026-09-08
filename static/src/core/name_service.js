/**
 * core/name_service.js
 * Local cache (id -> display_name) used by Many2one/Many2many widgets to
 * resolve labels without a network call when offline.
 *
*/

import { db } from "./orm/orm_service.js";

/**
 * Downloads all reference records for a model
 * (id, display_name, and optionally symbol/position for a currency) and
 * completely replaces the local cache for that model.
 */
export async function fetchAndStoreReferenceRecords(modelName, apiKey, baseUrl) {
  const response = await fetch(
    `${baseUrl}/offline_sync/reference_records?model=${encodeURIComponent(modelName)}`,
    { headers: { Authorization: `Bearer ${apiKey}` } }
  );

  if (!response.ok) {
    throw new Error(`Erreur récupération ${modelName}: ${response.status}`);
  }

  const data = await response.json();

  await db.transaction("rw", db.reference_records, async () => {
    await db.reference_records.where("model").equals(modelName).delete();
    await db.reference_records.bulkAdd(
      data.records.map((r) => ({
        model: modelName,
        id: r.id,
        display_name: r.display_name,
        ...(r.symbol !== undefined ? { symbol: r.symbol, position: r.position } : {}),
      }))
    );
  });

  return data.records;
}

/** Read from local cache only (used by the Many2one widget). */
export async function getReferenceRecords(modelName) {
  return await db.reference_records.where("model").equals(modelName).toArray();
}

/**
 * Main entry point for use throughout the app: attempts a
 * network refresh if online, falling back silently to the
 * local cache otherwise (or if the network fails).
 */
export async function getReferenceRecordsSmart(modelName, apiKey, baseUrl) {
  if (!navigator.onLine) {
    return await getReferenceRecords(modelName);
  }

  try {
    return await fetchAndStoreReferenceRecords(modelName, apiKey, baseUrl);
  } catch (err) {
    console.warn(`Fetch reference_records échoué pour ${modelName}, utilisation du cache:`, err);
    return await getReferenceRecords(modelName);
  }
}
