/**
 * owl/app.js
 * ==========
 */
export const OWL_DEV_MODE =
  typeof location !== "undefined" &&
  (location.hostname === "localhost" || location.hostname === "127.0.0.1");

const pendingConnections = new Set();
let sharedObserver = null;

function waitUntilConnected(el) {
  if (el.isConnected) return Promise.resolve();

  return new Promise((resolve) => {
    const entry = { el, resolve };
    pendingConnections.add(entry);

    if (!sharedObserver) {
      sharedObserver = new MutationObserver(() => {
        for (const pending of pendingConnections) {
          if (pending.el.isConnected) {
            pendingConnections.delete(pending);
            pending.resolve();
          }
        }
        if (pendingConnections.size === 0) {
          sharedObserver.disconnect();
          sharedObserver = null;
        }
      });
      sharedObserver.observe(document.body, { childList: true, subtree: true });
    }
  });
}

/**
 * Monte un composant OWL racine dans un conteneur DOM.
 * @param {typeof owl.Component} RootComponent
 * @param {HTMLElement} target - conteneur, connecté au document ou non
 *   (le mount attend sa connexion si nécessaire)
 * @param {Object} [props] - props initiales du composant racine
 * @param {Object<string,string>|string} [templates] - soit une map
 *   { nom: xmlString }, soit une chaîne XML unique contenant plusieurs
 *   <t t-name="..."> (cf. owl/templates.js pour le chargement depuis
 *   des fichiers .xml importés en texte brut via esbuild --loader:.xml=text)
 * @returns {Promise<{component: owl.Component, app: owl.App, destroy: Function}>}
 */
export async function mountOwlApp(RootComponent, target, props = {}, templates = {}) {
  await waitUntilConnected(target);

  const app = new owl.App(RootComponent, {
    dev: OWL_DEV_MODE,
    props,
    templates,
  });

  const component = await app.mount(target);

  return {
    component,
    app,
    destroy: () => app.destroy(),
  };
}