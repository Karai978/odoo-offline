/**
 * owl/components/debug_ping/debug_ping.js
 * ========================================
 * Composant de validation de la chaîne OWL complète : template XML
 * (compilé depuis un fichier .xml séparé), état réactif (useState),
 * gestion d'événement (t-on-click). Volontairement isolé de
 * core/registry.js et de views/view.js — rien dans le SPA existant
 * n'en dépend ni ne le monte automatiquement.
 *
 * Déclenchement manuel pour test, depuis la console navigateur :
 *   window.__owl_debug__.mountSmokeTest()
 * (câblé dans main.js, section "OWL — architecture en place").
 */

import templateXml from "./debug_ping.xml";

const TEMPLATE_NAME = "pwa_offline.DebugPing";

export class DebugPing extends owl.Component {
  static template = TEMPLATE_NAME;
  static props = {
    onClose: { type: Function, optional: true },
  };

  setup() {
    this.state = owl.useState({ count: 0 });
  }

  increment() {
    this.state.count++;
  }

  destroyMe() {
    if (this.props.onClose) this.props.onClose();
  }
}

DebugPing.templateXml = templateXml;
DebugPing.templateName = TEMPLATE_NAME;
