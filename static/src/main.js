import { registry } from "./core/registry.js";
import { bus } from "./core/bus/bus_service.js";
import { router } from "./core/browser/router_service.js";
import { CONFIG, getSession } from "./core/browser/session.js";
import { db } from "./core/orm_service.js";
import { evaluateSimpleCondition } from "./core/py_js/py_utils.js";
import { initRulesEngine } from "./model/rules_engine/rules_engine.js";
import { allRules } from "./model/rules_engine/rules/index.js";

import "./webclient/login.js";
import { mountWebclient } from "./webclient/webclient.js";
import "./views/view.js";
import "./webclient/home_menu/home_menu.js";


// OWL — architecture en place (voir static/src/owl/), rien de branché
// au SPA existant. Import de validation manuelle uniquement, cf.
// static/src/owl/debug.js.
import { owlDebug } from "./owl/debug.js";

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

  // Doit être fait avant tout rendu de formulaire/liste : les règles
  // d'accès/défaut (model "*") sont consultées dès l'évaluation des
  // premières expressions invisible/readonly (voir py_utils.js).
  initRulesEngine(allRules);

  registerServiceWorker();

  bus.trigger("app:ready", {
    services: registry.category("services").getEntries().map(([k]) => k),
    initialRouterState: router.current,
  });

  const actionService = mountWebclient();
  window.__pwa_debug__ = { registry, bus, router, actionService };
  window.__owl_debug__ = owlDebug;
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
