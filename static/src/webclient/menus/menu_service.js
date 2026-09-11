/**
 * webclient/menus/menu_service.js
 * Local cache of
 * installed apps (root menu), used by home_menu.js (app
 * grid) and navbar.js (quick selector).
 */

import { db } from "../../core/orm_service.js";

export async function saveCachedApps(apps) {
  await db.transaction("rw", db.installed_apps, async () => {
    await db.installed_apps.clear();
    await db.installed_apps.bulkAdd(apps.map((app) => ({
      ...app,
      technical_name: app.technical_name, // explicit primary key
    })));
  });
}

/** Retrieves the list of installed apps from the local cache. */
export async function getCachedApps() {
  return await db.installed_apps.toArray();
}
