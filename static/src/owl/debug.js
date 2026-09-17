/**
 * owl/debug.js
 * ============
 * Câblé (import) dans main.js mais jamais exécuté automatiquement au
 * boot : sert uniquement à valider manuellement, depuis la console,
 * que la chaîne owl.iife.js -> mountOwlApp -> template .xml -> state
 * réactif fonctionne de bout en bout, sans toucher au SPA existant.
 *
 * Usage (console navigateur, une fois l'app chargée) :
 *   window.__owl_debug__.mountSmokeTest()
 *   window.__owl_debug__.unmountSmokeTest()
 */

import { mountOwlApp } from "./app.js";
import { buildTemplateMap } from "./templates.js";
import { DebugPing } from "./components/debug_ping/debug_ping.js";

let activeInstance = null;

async function mountSmokeTest() {
  if (activeInstance) {
    console.warn("[owl smoke test] déjà monté — appelez unmountSmokeTest() d'abord.");
    return activeInstance.component;
  }

  const container = document.createElement("div");
  container.id = "owl-smoke-test-container";
  container.style.cssText = "position:fixed; bottom:16px; right:16px; z-index:9999;";
  document.body.appendChild(container);

  const templates = buildTemplateMap([[DebugPing.templateName, DebugPing.templateXml]]);

  const { component, destroy } = await mountOwlApp(
    DebugPing,
    container,
    { onClose: unmountSmokeTest },
    templates
  );

  activeInstance = { component, destroy, container };
  console.info("[owl smoke test] monté avec succès — OWL fonctionne.");
  return component;
}

function unmountSmokeTest() {
  if (!activeInstance) return;
  activeInstance.destroy();
  activeInstance.container.remove();
  activeInstance = null;
  console.info("[owl smoke test] démonté.");
}

export const owlDebug = { mountSmokeTest, unmountSmokeTest };
