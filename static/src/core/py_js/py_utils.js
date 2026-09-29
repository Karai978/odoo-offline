/**
 * core/py_js/py_utils.js
 * Translates an Odoo conditional expression (syntax similar to Python:
 * not / and / or / in / not in / True / False) into evaluable JavaScript,
 * while keeping field names intact for subsequent resolution.
*/

// Transpiles an Odoo Python expression string into a 
// valid JavaScript conditional expression.
export function translateOdooExprToJs(expr) {
  let js = expr;

  js = js.replace(/\bTrue\b/g, "true");
  js = js.replace(/\bFalse\b/g, "false");
  js = js.replace(/\bNone\b/g, "false");

  // "X not in [..]" / "X not in (..)" -> "![...].includes(X)"
  // X peut être un identifiant (nom de champ) OU un littéral string
  js = js.replace(/('[^']*'|"[^"]*"|\w+)\s+not\s+in\s+(\[[^\]]*\]|\([^)]*\))/g, (_, field, list) => {
    const arr = list.replace(/^\(/, "[").replace(/\)$/, "]");
    return `!(${arr}).includes(${field})`;
  });
  // "X in [..]" / "X in (..)" -> "[...].includes(X)"
  js = js.replace(/('[^']*'|"[^"]*"|\w+)\s+in\s+(\[[^\]]*\]|\([^)]*\))/g, (_, field, list) => {
    const arr = list.replace(/^\(/, "[").replace(/\)$/, "]");
    return `(${arr}).includes(${field})`;
  });

  js = js.replace(/\bnot\s+/g, "!");
  js = js.replace(/\band\b/g, "&&");
  js = js.replace(/\bor\b/g, "||");

  return js;
}

/**
 * Replaces "parent.field" references with the actual value of the
 * corresponding field in the parent record (used by one2many table
 * columns, e.g., column_invisible="parent.state not in (...)").
 * We substitute directly with a literal value before translation,
 * because "parent.state" is not a valid JS identifier to be resolved later.
 */
export function resolveParentReferences(expr, parentValues) {
  if (!parentValues) return expr;
  return expr.replace(/\bparent\.(\w+)\b/g, (_, field) => {
    let val = parentValues[field];
    if (Array.isArray(val)) val = val[1]; // many2one -> libellé
    if (val === undefined || val === null || val === false) return "false";
    return JSON.stringify(val);
  });
}

/**
 * Evaluates an Odoo conditional expression (invisible/readonly/required)
 * against the current form values. Supports: ==, !=, not, and,
 * or, in, not in, True/False — not just "field == 'x'".
 * Special case: new record (no ID) without 'state' -> treated
 * as state == 'draft', so that creation action buttons
 * display correctly.
 */
export function evaluateSimpleCondition(expr, currentValues, parentValues = null) {
  if (!expr) return null;

  if (parentValues) {
    expr = resolveParentReferences(expr, parentValues);
  }

  const isNewRecord = !currentValues || !currentValues.id;
  const values = { ...(currentValues || {}) };

  if (isNewRecord && (values.state === undefined || values.state === false)) {
    values.state = "draft";
  }

  const jsExpr = translateOdooExprToJs(expr);

  // Fields referenced in the expression but missing from the current
  // values ​​-> treated as "false" (Odoo's default behavior).
  const identifiers = jsExpr.match(/\b[A-Za-z_]\w*\b/g) || [];
  const reserved = new Set(["true", "false", "includes"]);
  identifiers.forEach((id) => {
    if (!reserved.has(id) && !(id in values)) values[id] = false;
  });

  try {
    const fn = new Function(...Object.keys(values), `return (${jsExpr});`);
    return !!fn(...Object.values(values));
  } catch (err) {
    console.warn("Expression invisible/readonly non supportée:", expr, err);
    return null;
  }
}

/**
 * Determines whether an architecture node (field, group, etc.) should be displayed in the interface,
 * by combining the dynamic 'invisible' attribute with a basic group check
 * (admin-only, in the absence of a true multi-level offline group system).
 */
export function isNodeVisible(node, securityContext, currentValues) {
  const invisibleAttr = node.getAttribute("invisible");
  if (invisibleAttr) {
    if (invisibleAttr === "1" || invisibleAttr === "True") return false;
    const result = evaluateSimpleCondition(invisibleAttr, currentValues);
    if (result === true) return false;
  }

  const groupsAttr = node.getAttribute("groups");
  if (groupsAttr) {
    if (!groupsAttr.startsWith("!") && (!securityContext || !securityContext.is_admin)) {
      return false;
    }
  }

  return true;
}

/**
 * Convertit un domaine Odoo simple (liste de triplets [field, operator,
 * value], combinés implicitement en ET — pas de gestion de '|'/'&'
 * préfixés explicites, hors scope pour un domaine de menu Devis/Commandes)
 * en une expression compatible evaluateSimpleCondition(), pour réutiliser
 * le même moteur de transpilation plutôt que d'en écrire un second.
 */
export function domainToExpr(domain) {
  if (!domain || domain.length === 0) return null;

  const parts = domain.map(([field, op, value]) => {
    const jsValue = JSON.stringify(value);
    switch (op) {
      case "in":
        return `${field} in ${jsValue.replace(/^\[/, "(").replace(/\]$/, ")")}`;
      case "not in":
        return `${field} not in ${jsValue.replace(/^\[/, "(").replace(/\]$/, ")")}`;
      case "=":
      case "==":
        return `${field} == ${jsValue}`;
      case "!=":
        return `${field} != ${jsValue}`;
      default:
        return "True"; // opérateur non géré : ne bloque pas la correspondance
    }
  });

  return parts.join(" and ");
}

/**
 * Teste si un record correspond au domaine d'un menu/action (ex: pour
 * choisir entre "Devis" et "Commandes" selon le state réel du document).
 * Réutilise evaluateSimpleCondition() — même moteur que pour
 * invisible/readonly, pas de logique de comparaison dupliquée.
 */
export function matchesDomain(record, domain) {
  const expr = domainToExpr(domain);
  if (!expr) return true; // pas de domaine = toujours correspondant
  const result = evaluateSimpleCondition(expr, record);
  return result === true;
}
