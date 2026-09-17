/**
 * owl/app.js
 * ==========
 * Point de bootstrap pour le futur moteur OWL. Volontairement isolé de
 * core/registry.js, core/bus/bus_service.js et views/view.js : tant que
 * la migration réelle des vues n'a pas commencé, rien ici n'est appelé
 * par le SPA existant (action_service.js, view.js, etc.).
 *
 * `owl` est un global vendorisé (window.owl), au même titre que Dexie
 * et Popper — voir static/lib/owl.iife.js. On ne fait pas
 * `import { App } from "owl"` (pas de résolution de module npm dans ce
 * bundler esbuild --bundle en mode IIFE sans node_modules embarqué) ;
 * on référence le global directement, comme le fait déjà le reste du
 * code pour `new Dexie(...)` ou `window.Popper.createPopper(...)`.
 */

/**
 * Mode dev OWL : active les warnings/validations internes d'OWL
 * (props, templates...). Activé automatiquement en local — jamais en
 * production (utile pour ne pas payer le coût des validations
 * supplémentaires une fois le module réellement déployé chez un
 * client).
 */
export const OWL_DEV_MODE =
  typeof location !== "undefined" &&
  (location.hostname === "localhost" || location.hostname === "127.0.0.1");

/**
 * Monte un composant OWL racine dans un conteneur DOM.
 *
 * CORRECTIF (build vendorisé hash 52abf8d, cf. static/lib/owl.iife.js) :
 * un premier passage avait conclu — à tort — que cette version d'OWL
 * n'exportait pas `App` (erreur de lecture : seule la fin du fichier
 * avait été inspectée). `App` EST exportée (37 exports au total,
 * `App` inclus) ; on l'utilise donc directement plutôt que le détour
 * par `component.__owl__.app`, ce qui donne un accès explicite et
 * plus lisible à `.destroy()`.
 *
 * @param {typeof owl.Component} RootComponent
 * @param {HTMLElement} target - conteneur déjà présent dans le DOM
 * @param {Object} [props] - props initiales du composant racine
 * @param {Object<string,string>|string} [templates] - soit une map
 *   { nom: xmlString }, soit une chaîne XML unique contenant plusieurs
 *   <t t-name="..."> (cf. owl/templates.js pour le chargement depuis
 *   des fichiers .xml importés en texte brut via esbuild --loader:.xml=text)
 * @returns {Promise<{component: owl.Component, app: owl.App, destroy: Function}>}
 */
export async function mountOwlApp(RootComponent, target, props = {}, templates = {}) {
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
