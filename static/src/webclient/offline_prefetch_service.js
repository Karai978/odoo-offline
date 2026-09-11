/**
 * webclient/offline_prefetch_service.js
 */

import { fetchAndStoreModuleManifest } from "../views/view_service.js";
import { fetchAndStoreListRecords } from "../core/list_cache.js";
import { fetchAndStoreRecord } from "../core/record_cache.js";
import { fetchAndStoreReferenceRecords } from "../core/name_service.js";
import { fetchAndStoreSecurityInfo } from "../core/user_service.js";

export async function downloadFullApp(moduleName, apiKey, baseUrl, onProgress = () => {}) {
  onProgress(`Téléchargement du manifest de ${moduleName}...`);
  const manifest = await fetchAndStoreModuleManifest(moduleName, apiKey, baseUrl);

  const models = manifest.models || [];

  onProgress(`Récupération des droits d'accès pour ${moduleName}...`);

  try {
    await fetchAndStoreSecurityInfo(apiKey, baseUrl, models);
  } catch (err) {
    console.warn(`Droits d'accès non récupérés pour ${moduleName}:`, err);
  }

  const relationsToPreload = new Set();

  // Model -> list of actionIds using it (a single model
  // can be opened via multiple menus with different views/domains,
  // e.g., Quotations vs. Sales Orders for sale.order) — essential for constructing
  // the SAME cache key ("model::actionId") as the one used during
  // retrieval by getListRecordsSmart() in views/list/list_controller.js;
  // otherwise, the download populates a cache that is never subsequently accessed offline.
  const modelActionIds = {};
  for (const menu of manifest.menus || []) {
    if (menu.model && menu.action_id) {
      if (!modelActionIds[menu.model]) modelActionIds[menu.model] = new Set();
      modelActionIds[menu.model].add(menu.action_id);
    }
  }

  // 1. Collection of Many2one relationships
  for (const modelName of models) {
    const fieldsInfo = manifest.fields[modelName] || {};
    for (const finfo of Object.values(fieldsInfo)) {
      if (finfo.type === "many2one" && finfo.relation) {
        relationsToPreload.add(finfo.relation);
      }
      if (finfo.type === "one2many" && finfo.sub_fields) {
        for (const subInfo of Object.values(finfo.sub_fields)) {
          if (subInfo.type === "many2one" && subInfo.relation) {
            relationsToPreload.add(subInfo.relation);
          }
        }
      }
    }
  }

  // 2. Downloading the lists for each model AND their individual data sheets
  let modelIndex = 0;
  for (const modelName of models) {
    modelIndex++;
    onProgress(`Modèle ${modelIndex}/${models.length} : ${modelName} (Liste)...`);

    const actionIdsForModel = modelActionIds[modelName]
      ? Array.from(modelActionIds[modelName])
      : [null];

    try {
      const allRecordIds = new Set();
      for (const actionId of actionIdsForModel) {
        const cacheKey = actionId ? `${modelName}::${actionId}` : modelName;
        const data = await fetchAndStoreListRecords(modelName, apiKey, baseUrl, actionId, cacheKey);
        (data?.records || []).forEach((r) => allRecordIds.add(r.id));
      }

      const idsArray = Array.from(allRecordIds);
      if (idsArray.length > 0) {
        onProgress(`Modèle ${modelName} : Téléchargement de ${idsArray.length} fiches individuelles...`);

        for (let i = 0; i < idsArray.length; i++) {
          if (i % 5 === 0) {
            onProgress(`Modèle ${modelName} : Fiche ${i + 1}/${idsArray.length}...`);
          }
          await fetchAndStoreRecord(modelName, idsArray[i], apiKey, baseUrl);
        }
      }
    } catch (err) {
      console.warn(`Impossible de télécharger les données complètes pour ${modelName}:`, err);
    }
  }

  // 3. Downloading relationships (Many2one reference tables)
  let relIndex = 0;
  const relationsArray = Array.from(relationsToPreload);
  for (const relModel of relationsArray) {
    relIndex++;
    onProgress(`Relation ${relIndex}/${relationsArray.length} : ${relModel}...`);
    try {
      await fetchAndStoreReferenceRecords(relModel, apiKey, baseUrl);
    } catch (err) {
      console.warn(`Impossible de télécharger les relations de ${relModel}:`, err);
    }
  }

  onProgress(`${moduleName} prêt hors-ligne (${models.length} modèles synchronisés avec leurs fiches)`);
  return { models: models.length, relations: relationsArray.length };
}
