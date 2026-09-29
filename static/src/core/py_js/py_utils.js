/**
 * core/py_js/py_utils.js
 * Translates an Odoo conditional expression (syntax similar to Python:
 * not / and / or / in / not in / True / False) into evaluable JavaScript,
 * while keeping field names intact for subsequent resolution.
 * Also evaluates Odoo domains (prefix notation) against a record.
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

  // Alignement sur la sémantique Python : une liste vide (one2many/
  // many2many sans valeur) est falsy en Python, contrairement à un
  // tableau JS qui est toujours truthy — impacte invisible/readonly/required.
  for (const key of Object.keys(values)) {
    if (Array.isArray(values[key]) && values[key].length === 0) {
      values[key] = false;
    }
  }

  if (isNewRecord && (values.state === undefined || values.state === false)) {
    values.state = "draft";
  }

  const jsExpr = translateOdooExprToJs(expr);

  // Fields referenced in the expression but missing from the current
  // values -> treated as "false" (Odoo's default behavior).
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
 * Évalue une feuille de domaine Odoo [field, op, value] contre un record.
 * Les opérateurs non gérés sont traités comme toujours vrais (ne bloquent
 * pas la correspondance).
 */
function evaluateDomainLeaf(record, [field, op, value]) {
  const raw = record ? record[field] : undefined;
  switch (op) {
    case "=":
    case "==":
      return raw === value;
    case "!=":
      return raw !== value;
    case "in":
      return Array.isArray(value) && value.includes(raw);
    case "not in":
      return !(Array.isArray(value) && value.includes(raw));
    default:
      return true;
  }
}

/**
 * Évalue un domaine Odoo complet en notation préfixe standard
 * (ex: ['&', a, '|', b, c] = a AND (b OR c)).
 *
 * Parcours DROITE -> GAUCHE avec une pile : chaque opérateur préfixe
 * consomme les résultats déjà empilés par ses opérandes. Un domaine
 * "plat" sans opérateur explicite reste combiné en ET implicite via
 * stack.every() à la fin.
 */
function evaluateDomainArray(record, domain) {
  const stack = [];
  for (let i = domain.length - 1; i >= 0; i--) {
    const token = domain[i];
    if (token === "&") {
      const a = stack.pop();
      const b = stack.pop();
      stack.push(!!a && !!b);
    } else if (token === "|") {
      const a = stack.pop();
      const b = stack.pop();
      stack.push(!!a || !!b);
    } else if (token === "!") {
      stack.push(!stack.pop());
    } else if (Array.isArray(token)) {
      stack.push(evaluateDomainLeaf(record, token));
    } else {
      console.warn("[py_utils] Token de domaine non reconnu, ignoré:", token);
    }
  }
  return stack.every(Boolean);
}

/**
 * Teste si un record correspond à un domaine Odoo (menu Devis/Commandes...).
 * Supporte '&'/'|'/'!' préfixés, en plus de l'ET implicite entre triplets.
 */
export function matchesDomain(record, domain) {
  if (!domain || domain.length === 0) return true; // pas de domaine = toujours correspondant
  return evaluateDomainArray(record, domain);
}