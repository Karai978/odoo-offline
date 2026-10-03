import { registry } from "./core/registry.js";
import { bus } from "./core/bus/bus_service.js";
import { router } from "./core/browser/router_service.js";
import { CONFIG } from "./core/browser/session.js";
import { db } from "./core/orm_service.js";
import { evaluateSimpleCondition } from "./core/py_js/py_utils.js";
import "./webclient/login.js";
import { mountWebclient } from "./webclient/webclient.js";
import "./views/view.js";
import "./webclient/home_menu/home_menu.js";
// Règles métier offline par domaine (équivalent JS des
// @api.onchange / @api.depends / @api.constrains d'Odoo 17) :
import "./business_rules/sale_rules.js";
import "./business_rules/purchase_rules.js";
import "./business_rules/stock_rules.js";
import "./business_rules/account_rules.js";

// Fusionné depuis core/browser/service_worker.js : chez Odoo l'enregistrement
// du Service Worker se fait directement au boot, sans fichier dédié.
function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("/service-worker.js")
      .then(() => console.log("Service Worker enregistré"))
      .catch((err) => console.error("Échec Service Worker :", err));
  }
}

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

  const actionService = mountWebclient();
  window.__pwa_debug__ = { registry, bus, router, actionService };
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
