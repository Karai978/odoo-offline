/**
 * core/name_service.js
 * Local cache (id -> display_name) used by Many2one/Many2many widgets to
 * resolve labels without a network call when offline.
 *
*/

import { db } from "./orm_service.js";

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
 * Mémo des modèles dont le fetch reference_records a ÉCHOUÉ récemment
 * (ex: backend qui ne sert pas ce modèle → 400). Sans ce mémo, une règle
 * onchange ré-exécutée à chaque événement input/change re-tenterait la
 * requête en boucle (spam réseau + console). TTL 5 minutes : si le
 * serveur se remet à servir le modèle (démarrage, update du module),
 * le prochain essai repartira sur le réseau.
 */
const failedReferenceModels = new Map(); // model -> horodatage de l'échec
const REFERENCE_FAIL_TTL = 5 * 60 * 1000;

/**
 * Main entry point for use throughout the app: attempts a
 * network refresh if online, falling back silently to the
 * local cache otherwise (or if the network fails).
 */
export async function getReferenceRecordsSmart(modelName, apiKey, baseUrl) {
  const lastFail = failedReferenceModels.get(modelName);
  if (navigator.onLine && Date.now() - (lastFail || 0) > REFERENCE_FAIL_TTL) {
    try {
      const data = await fetchAndStoreReferenceRecords(modelName, apiKey, baseUrl);
      failedReferenceModels.delete(modelName);
      return data;
    } catch (err) {
      failedReferenceModels.set(modelName, Date.now());
      console.warn(`Fetch reference_records échoué pour ${modelName}, utilisation du cache (retry dans ${Math.round(REFERENCE_FAIL_TTL / 60000)} min):`, err.message);
      return await getReferenceRecords(modelName);
    }
  }
  return await getReferenceRecords(modelName);
}
