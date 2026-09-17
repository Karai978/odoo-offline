/**
 * model/rules_engine/rules/access_rules.js
 * ===========================================
 * Règles d'accès génériques (applicables à tous les modèles, model: "*") :
 *  - droits CRUD (ir.model.access) : déplacé depuis
 *    core/user_service.js::canPerform()
 *  - visibilité par groupe (attribut XML groups="...") : déplacé depuis
 *    core/py_js/py_utils.js::isNodeVisible()
 *
 * Ces règles ne dépendent pas d'un modèle précis car l'algorithme est
 * identique pour tous les modèles -- seules les données (securityContext)
 * varient, et celles-ci sont déjà résolues par model: "*" avant l'appel.
 */

export const accessRules = [
  {
    model: "*",
    type: "access",
    subtype: "crud",
    name: "generic_crud_rights",
    // securityContext: { is_admin, rights: {read, write, create, unlink} }
    // action: "read" | "write" | "create" | "unlink"
    evaluate(securityContext, action) {
      if (!securityContext) return false; // pas encore de droits en cache -- refus par prudence
      if (securityContext.is_admin) return true;
      return !!(securityContext.rights && securityContext.rights[action]);
    },
  },
  {
    model: "*",
    type: "access",
    subtype: "groups",
    name: "generic_groups_visibility",
    // groupsAttr: valeur brute de l'attribut XML groups="..."
    // securityContext: { is_admin, groups }
    evaluate(groupsAttr, securityContext) {
      if (!groupsAttr) return true;
      if (groupsAttr.startsWith("!")) return true; // "groups négatif" -- non géré, jamais bloquant (comportement d'origine)
      // Simplifié (voir audit) : pas de vraie résolution multi-groupes tant
      // que le backend n'expose pas les xml_id de groupes hors-ligne --
      // seul le statut admin est distingué pour l'instant.
      return !!(securityContext && securityContext.is_admin);
    },
  },
];
