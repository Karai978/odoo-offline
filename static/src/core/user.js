/**
 * core/user.js
 * Cache the logged-in user's access rights locally (IndexedDB) 
 * for each Odoo model, in order to hide, gray out, or disable buttons 
 * and actions (create, edit, delete, read) even when the user is offline
*/

import { db } from "./orm/orm_service.js";

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
