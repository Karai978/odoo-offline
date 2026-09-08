/**
 * core/user_profile.js
 * Cache local des informations de profil affichées dans "Mon compte"
 * (nom, société, etc.) — permet au modal de fonctionner même hors-ligne
 * ou depuis un écran autre que le dashboard (qui est le seul endroit à
 * appeler /offline_sync/dashboard_info pour l'instant).
 * Réutilise la table cache_meta (clé/valeur générique), déjà créée pour
 * cache_owner.js — pas besoin d'une table dédiée pour une seule valeur.
 */

import { db } from "./orm/orm_service.js";

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