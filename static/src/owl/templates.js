/**
 * owl/templates.js
 * ================
 * Stratégie de chargement des templates : chaque composant OWL a son
 * fichier .xml colocalisé (ex: debug_ping.xml à côté de
 * debug_ping.js), importé comme texte brut grâce au loader esbuild
 * dédié (--loader:.xml=text, ajouté dans scripts/build-bundle.sh).
 *
 * Alternative écartée : un fetch() runtime des .xml (comme le fait
 * Odoo en ligne pour ses assets qweb). Rejetée ici parce que
 * l'application doit fonctionner 100% hors-ligne dès le premier
 * chargement : mieux vaut inliner les templates dans le bundle unique
 * (app.bundle.js), cohérent avec le choix déjà fait pour tout le
 * reste du moteur (voir scripts/build-bundle.sh, un seul fichier de
 * sortie, pas de requêtes runtime pour le code applicatif).
 *
 * Chaque .xml de composant contient UN SEUL template racine, sans
 * balise <templates> englobante ni attribut t-name : le nom est déduit
 * du nom du composant JS, passé explicitement ici pour rester
 * explicite (pas de "magie" basée sur le nom de fichier).
 */

/**
 * Construit la map { name: xmlString } attendue par owl.mount()/App
 * à partir d'une liste de paires [name, xmlString importé].
 *
 * @param {Array<[string, string]>} entries
 * @returns {Object<string,string>}
 */
export function buildTemplateMap(entries) {
  const map = {};
  for (const [name, xmlString] of entries) {
    map[name] = xmlString;
  }
  return map;
}
