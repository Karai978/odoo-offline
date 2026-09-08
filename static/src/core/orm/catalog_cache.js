/**
 * core/orm/catalog_cache.js
 * Manages the storage and retrieval of the product catalog from the local cache
*/

import { db } from "./orm_service.js";

// Generates a unique key to isolate price lists and 
// catalogs based on the business context.
function buildCatalogCacheKey(model, partnerId) {
  return `${model}::${partnerId || "none"}`;
}

// Downloads the list of eligible products
// from the Odoo server and updates IndexedDB
export async function fetchAndStoreCatalogProducts(model, partnerId, apiKey, baseUrl) {
  const params = new URLSearchParams({ model });
  if (partnerId) params.set("partner_id", partnerId);

  const response = await fetch(
    `${baseUrl}/offline_sync/catalog/products?${params.toString()}`,
    { headers: { Authorization: `Bearer ${apiKey}` } }
  );

  if (!response.ok) {
    throw new Error(`Erreur récupération catalogue ${model}: ${response.status}`);
  }

  const data = await response.json();
  const key = buildCatalogCacheKey(model, partnerId);

  await db.catalog_cache.put({
    key,
    products: data.products || [],
    updated_at: new Date().toISOString(),
  });

  return data.products || [];
}

/** Read from local cache (used when offline, or as a fallback if the fetch fails). */
export async function getCatalogProducts(model, partnerId) {
  const key = buildCatalogCacheKey(model, partnerId);
  const entry = await db.catalog_cache.get(key);
  return entry ? entry.products : [];
}

/**
 * Main entry point: attempts the network if online, falls back to the
 * local cache otherwise — same behavior as getReferenceRecordsSmart.
 */
export async function getCatalogProductsSmart(model, partnerId, apiKey, baseUrl) {
  if (!navigator.onLine) {
    return await getCatalogProducts(model, partnerId);
  }

  try {
    return await fetchAndStoreCatalogProducts(model, partnerId, apiKey, baseUrl);
  } catch (err) {
    console.warn(`Fetch catalogue échoué pour ${model}, utilisation du cache:`, err);
    return await getCatalogProducts(model, partnerId);
  }
}
