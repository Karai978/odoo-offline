/**
 * core/user_service.js
 * Fusion de core/user.js (droits d'accès) et core/user_profile.js (profil affiché)
 * — chez Odoo, ces deux responsabilités vivent dans un seul fichier user_service.js.
 *
 * 1) Cache les droits d'accès (CRUD, groupes) de l'utilisateur connecté en local
 *    (IndexedDB) pour chaque modèle Odoo, afin de masquer/griser les boutons et
 *    actions même hors-ligne.
 * 2) Cache local des informations de profil affichées dans "Mon compte"
 *    (nom, société, etc.) — permet au modal de fonctionner même hors-ligne
 *    ou depuis un écran autre que le dashboard (qui est le seul endroit à
 *    appeler /offline_sync/dashboard_info pour l'instant).
 *    Réutilise la table cache_meta (clé/valeur générique), déjà créée pour
 *    cache_owner.js — pas besoin d'une table dédiée pour une seule valeur.
 */

import { db } from "./orm_service.js";

/* ---------------------------------------------------------------------- */
/* Droits d'accès (ex core/user.js)                                       */
/* ---------------------------------------------------------------------- */

// Download the set of security rules, CRUD access rights,
// and groups assigned to the user from Odoo, then update IndexedDB.
export async function fetchAndStoreSecurityInfo(apiKey, baseUrl, models = null) {
  const url = new URL(`${baseUrl}/offline_sync/security_info`);
  if (models && models.length > 0) {
    url.searchParams.set("models", models.join(","));
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    throw new Error(`Erreur récupération droits: ${response.status}`);
  }

  const data = await response.json();
  const now = new Date().toISOString();

  const records = Object.entries(data.models).map(([modelName, info]) => ({
    model: modelName,
    rights: info.access,
    record_rule_domain: info.domain || [],
    fields: info.fields || [],
    groups: data.groups,
    is_admin: data.is_admin,
    updated_at: now,
  }));

  await db.security_info.bulkPut(records);
  return data;
}

/**
 * Quick read of permissions for a given model (used by
 * view controllers and the dashboard to hide/grey out buttons).
 */
export async function getSecurityInfo(modelName) {
  return await db.security_info.get(modelName);
}

/**
 * Simple check to call before displaying a button or authorizing
 * a local action (e.g., before allowing "Delete" on an order).
 */
export async function canPerform(modelName, action) {
  // action: "read" | "write" | "create" | "unlink"
  const info = await getSecurityInfo(modelName);
  if (!info) return false; // by default, deny if not yet in cache
  if (info.is_admin) return true;
  return !!info.rights[action];
}

/* ---------------------------------------------------------------------- */
/* Profil affiché (ex core/user_profile.js)                               */
/* ---------------------------------------------------------------------- */

const PROFILE_KEY = "profile";

export async function saveCachedProfile(profile) {
  await db.cache_meta.put({
    key: PROFILE_KEY,
    value: { ...profile, cached_at: new Date().toISOString() },
  });
}

export async function getCachedProfile() {
  const meta = await db.cache_meta.get(PROFILE_KEY);
  return meta?.value ?? null;
}
