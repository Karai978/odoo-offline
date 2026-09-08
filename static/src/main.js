import { registry } from "./core/registry.js";
import { bus } from "./core/bus/bus_service.js";
import { router } from "./core/browser/router.js";
import { CONFIG, getSession } from "./core/browser/session.js";
import { db } from "./core/orm/orm_service.js";
import { evaluateSimpleCondition } from "./core/py_js/py_utils.js";
import { registerServiceWorker } from "./core/browser/service_worker.js";

import "./webclient/login.js";
import { mountWebclient } from "./webclient/webclient.js";
import "./views/view.js";
import "./webclient/home_menu/home_menu.js";

function startServices() {
  const started = {};
  for (const [name, service] of registry.category("services").getEntries()) {
    started[name] = service.start();
  }
  return started;
}

function boot() {
  startServices();

  registerServiceWorker();

  bus.trigger("app:ready", {
    services: registry.category("services").getEntries().map(([k]) => k),
    initialRouterState: router.current,
  });

  console.log("[pwa-standalone] Phase 6 démarrée", {
    ODOO_BASE_URL: CONFIG.ODOO_BASE_URL,
    dbName: db.name,
    session: getSession(),
    pyUtilsSample: evaluateSimpleCondition("state == 'draft'", {}),
    actionsRegistered: registry.category("actions").getEntries().map(([k]) => k),
  });

  const actionService = mountWebclient();
  window.__pwa_debug__ = { registry, bus, router, actionService };
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
