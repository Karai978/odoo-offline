/**
 * core/list_cache.js
 * Local cache for record lists by (model + action + additional domain),
 * as well as for the statistics banner on the Purchasing dashboard.
 *
*/

import { db } from "./orm_service.js";

/**
 * Generates a unique indexing key to isolate different list view requests
 * within the IndexedDB list_cache table.
 */
function buildListCacheKey(modelName, actionId, extraDomain) {
  let key = actionId ? `${modelName}::${actionId}` : modelName;
  if (extraDomain) key += `::${JSON.stringify(extraDomain)}`;
  return key;
}

/**
 * Downloads a list of records from the Odoo server and stores it 
 * in the local cache
*/
export async function fetchAndStoreListRecords(
  modelName,
  apiKey,
  baseUrl,
  actionId = null,
  cacheKey = null,
  extraDomain = null
) {
  const key = cacheKey || modelName;

  const url = new URL(`${baseUrl}/offline_sync/list_records`);
  url.searchParams.set("model", modelName);
  if (actionId) url.searchParams.set("action", actionId);
  if (extraDomain) url.searchParams.set("extra_domain", JSON.stringify(extraDomain));

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new Error(`Erreur liste ${modelName}: ${response.status}`);

  const data = await response.json();
  await db.list_cache.put({
    model: key,
    records: data.records,
    total: data.total,
    updated_at: new Date().toISOString(),
  });
  return data;
}

// Retrieves a list entry from the local cache using the generated key
export async function getCachedListRecords(cacheKey) {
  return await db.list_cache.get(cacheKey);
}

/**
 * Main entry point for loading a list
 */
export async function getListRecordsSmart(
  modelName,
  apiKey,
  baseUrl,
  actionId = null,
  extraDomain = null
) {
  const cacheKey = buildListCacheKey(modelName, actionId, extraDomain);

  if (!navigator.onLine) {
    const cached = await getCachedListRecords(cacheKey);
    if (!cached) throw new Error(`Aucune liste en cache pour "${modelName}".`);
    return cached;
  }
  try {
    return await fetchAndStoreListRecords(modelName, apiKey, baseUrl, actionId, cacheKey, extraDomain);
  } catch (err) {
    console.warn(`Fetch liste échoué pour ${modelName}, cache utilisé:`, err);
    const cached = await getCachedListRecords(cacheKey);
    if (!cached) throw err;
    return cached;
  }
}

/**
 * Downloads metrics/KPIs for the top Purchasing banner (purchase.order)
 * and updates db.dashboard_cache
 */
export async function fetchAndStorePurchaseDashboard(apiKey, baseUrl, actionId = null) {
  const url = new URL(`${baseUrl}/offline_sync/purchase_dashboard`);
  if (actionId) url.searchParams.set("action", actionId);

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new Error(`Erreur dashboard achats: ${response.status}`);

  const data = await response.json();
  const cacheKey = actionId ? `purchase_order::${actionId}` : "purchase_order";
  await db.dashboard_cache.put({
    key: cacheKey,
    data,
    updated_at: new Date().toISOString(),
  });
  return data;
}

// Retrieves dashboard data from the local cache.
export async function getCachedPurchaseDashboard(actionId = null) {
  const cacheKey = actionId ? `purchase_order::${actionId}` : "purchase_order";
  return await db.dashboard_cache.get(cacheKey);
}

// Retrieves the dashboard intelligently (server if online, otherwise cache)
export async function getPurchaseDashboardSmart(apiKey, baseUrl, actionId = null) {
  if (!navigator.onLine) {
    const cached = await getCachedPurchaseDashboard(actionId);
    return cached ? cached.data : null;
  }
  try {
    return await fetchAndStorePurchaseDashboard(apiKey, baseUrl, actionId);
  } catch (err) {
    console.warn("Fetch dashboard achats échoué, cache utilisé:", err);
    const cached = await getCachedPurchaseDashboard(actionId);
    return cached ? cached.data : null;
  }
}

/**
 * Une ligne list_cache est indexée par une clé composite basée sur le
 * modèle (voir buildListCacheKey) : "model", "model::actionId" ou
 * "model::actionId::domaine". Pour garder toutes les vues liste d'un
 * modèle synchronisées, il faut retrouver toutes les lignes
 * concernées par ce modèle.
 */
async function getListCacheEntriesForModel(modelName) {
  const all = await db.list_cache.toArray();
  return all.filter((entry) => entry.model === modelName || entry.model.startsWith(`${modelName}::`));
}

/**
 * Insère ou met à jour un enregistrement dans toutes les listes mises
 * en cache pour son modèle, pour qu'une création/modification hors
 * ligne apparaisse immédiatement sans attendre un aller-retour serveur.
 */
export async function upsertRecordInAllLists(modelName, record) {
  const entries = await getListCacheEntriesForModel(modelName);
  for (const entry of entries) {
    const idx = entry.records.findIndex((r) => r.id === record.id);
    let newRecords;
    let newTotal = entry.total;
    if (idx >= 0) {
      newRecords = [...entry.records];
      newRecords[idx] = { ...newRecords[idx], ...record };
    } else {
      newRecords = [record, ...entry.records];
      newTotal = (entry.total || entry.records.length) + 1;
    }
    await db.list_cache.put({ ...entry, records: newRecords, total: newTotal, updated_at: new Date().toISOString() });
  }
}

/**
 * Renomme l'ID d'un enregistrement dans toutes les listes en cache
 * pour son modèle (ID temporaire "local:<uuid>" -> ID Odoo réel, une
 * fois synchronisé).
 */
export async function replaceRecordIdInAllLists(modelName, oldId, newId) {
  const entries = await getListCacheEntriesForModel(modelName);
  for (const entry of entries) {
    const idx = entry.records.findIndex((r) => r.id === oldId);
    if (idx === -1) continue;
    const newRecords = [...entry.records];
    newRecords[idx] = { ...newRecords[idx], id: newId };
    await db.list_cache.put({ ...entry, records: newRecords, updated_at: new Date().toISOString() });
  }
}