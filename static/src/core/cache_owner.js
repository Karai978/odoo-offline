/**
 * core/cache_owner.js
 * Prevents an Odoo user from silently inheriting the cache
 * IndexedDB left behind by a previous user on the same device
 */

import { db } from "./orm_service.js";

const OWNER_KEY = "owner";

/**
 * Verifies that the local cache belongs to newUserId. If the cache
 * belonged to another user, purges all tables (without
 * destroying the Dexie schema) before saving the new owner.
 *
 * @param {number} newUserId - Odoo UID of the user who just logged in
 */
export async function ensureCacheOwnership(newUserId) {
  if (newUserId === undefined || newUserId === null) {
    throw new Error("ensureCacheOwnership: newUserId manquant");
  }

  const meta = await db.cache_meta.get(OWNER_KEY);
  const previousOwner = meta?.value;

  const isDifferentOwner = previousOwner !== undefined && previousOwner !== newUserId;

  if (isDifferentOwner) {
    // Cache belonging to another user: complete purge.
    // sync_queue and sync_conflicts are intentionally included—pending
    // actions created by the previous user must never be replayed or
    // displayed under another user's identity.
    await db.transaction("rw", db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()));
    });
  }

  await db.cache_meta.put({ key: OWNER_KEY, value: newUserId });

  return { purged: isDifferentOwner };
}

/**
 * Read-only utility, useful for debugging or diagnostic display
 * (e.g., "cache currently associated with user X").
 */
export async function getCacheOwner() {
  const meta = await db.cache_meta.get(OWNER_KEY);
  return meta?.value ?? null;
}