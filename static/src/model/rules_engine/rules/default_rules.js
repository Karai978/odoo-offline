/**
 * model/rules_engine/rules/default_rules.js
 * ============================================
 * Valeurs par défaut implicites. Déplacé depuis
 * core/py_js/py_utils.js::evaluateSimpleCondition(), où le cas
 * "nouvel enregistrement sans state" était codé en dur pour que les
 * expressions invisible/readonly du type "state == 'draft'" fonctionnent
 * correctement sur les formulaires de création.
 */

export const defaultRules = [
  {
    model: "*",
    type: "default",
    field: "state",
    name: "default_state_draft_on_new",
    // currentValues: valeurs actuelles du formulaire (ou null/undefined)
    evaluate(currentValues) {
      const isNewRecord = !currentValues || !currentValues.id;
      const hasNoState = !currentValues || currentValues.state === undefined || currentValues.state === false;
      if (isNewRecord && hasNoState) return "draft";
      return undefined;
    },
  },
];
