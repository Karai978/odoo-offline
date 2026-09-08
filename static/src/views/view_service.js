/**
 * views/view_service.js
 * =======================
 * Loads and locally caches a module's complete manifest 
 * (view XML architecture, field definitions, menus).
 */

import { db } from "../core/orm/orm_service.js";

export async function fetchAndStoreModuleManifest(moduleName, apiKey, baseUrl) {
  const response = await fetch(
    `${baseUrl}/offline_sync/module_manifest?module=${encodeURIComponent(moduleName)}`,
    { headers: { Authorization: `Bearer ${apiKey}` } }
  );

  if (!response.ok) {
    throw new Error(`Erreur récupération manifest ${moduleName}: ${response.status}`);
  }

  const manifest = await response.json();

  await db.module_manifests.put({
    technical_name: moduleName,
    module: manifest.module,
    models: manifest.models,
    fields: manifest.fields,
    views: manifest.views,
    menus: manifest.menus,
    updated_at: new Date().toISOString(),
  });

  return manifest;
}

/** Read from local cache only (works offline). */
export async function getCachedModuleManifest(moduleName) {
  if (!moduleName) return undefined; 
  return await db.module_manifests.get(moduleName);
}

/**
 * Main entry point for use throughout the app: fetch fresh data if
 * online (with silent fallback to cache on network failure),
 * read directly from cache if offline.
 */
export async function getModuleManifest(moduleName, apiKey, baseUrl) {
  
  if (!moduleName) {
    throw new Error("getModuleManifest() appelé sans nom de module — descripteur d'action incomplet.");
  }

  if (!navigator.onLine) {
    const cached = await getCachedModuleManifest(moduleName);
    if (!cached) {
      throw new Error(`Aucun manifest en cache pour "${moduleName}" — connectez-vous en ligne au moins une fois.`);
    }
    return cached;
  }

  try {
    return await fetchAndStoreModuleManifest(moduleName, apiKey, baseUrl);
  } catch (err) {
    console.warn(`Fetch manifest échoué pour ${moduleName}, tentative depuis le cache:`, err);
    const cached = await getCachedModuleManifest(moduleName);
    if (!cached) throw err;
    return cached;
  }
}

/**
 * Resolves the views to use for a model: priority is given to the view
 * specific to the clicked action/menu (manifest.views[model].by_action),
 * falling back to the model's default view otherwise.
 */
export function resolveModelViews(manifest, model, actionId) {
  const modelViews = manifest.views && manifest.views[model];
  if (!modelViews) return null;
  if (actionId && modelViews.by_action && modelViews.by_action[actionId]) {
    return modelViews.by_action[actionId];
  }
  return modelViews.default || modelViews;
}
