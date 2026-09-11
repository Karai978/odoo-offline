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
