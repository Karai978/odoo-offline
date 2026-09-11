/**
 * views/kanban/kanban_compiler.js
 * Mini QWeb engine for templates <t t-name="kanban-box"> (t-if, t-esc, t-out,
 * t-attf-class, t-set...). Extrait de views/kanban/kanban_renderer.js pour
 * se conformer à l'organisation réelle d'Odoo, qui sépare le moteur de
 * compilation de templates (kanban_compiler.js) du rendu de la vue
 * (kanban_renderer.js).
 */

function translatePythonExpr(expr) {
  return expr
    .replace(/\bnot\s+/g, "!")
    .replace(/\band\b/g, "&&")
    .replace(/\bor\b/g, "||")
    .replace(/\bTrue\b/g, "true")
    .replace(/\bFalse\b/g, "false")
    .replace(/\bNone\b/g, "null");
}

export function evalKanbanExpr(expr, record, scope) {
  try {
    const translated = translatePythonExpr(expr);
    const fn = new Function("record", "scope", `with (scope) { return (${translated}); }`);
    return fn(record, scope);
  } catch (err) {
    console.warn("Expression kanban invalide:", expr, err);
    return undefined;
  }
}

function interpolateAttrf(str, record, scope) {
  return str.replace(/\{\{(.*?)\}\}/g, (_, expr) => {
    const val = evalKanbanExpr(expr.trim(), record, scope);
    return val === undefined || val === null || val === false ? "" : String(val);
  });
}

function kanbanImagePlaceholder() {
  return "assets/default-app.png";
}

export function renderKanbanNode(node, record, fieldsInfo, scope) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent;
    return text.trim() ? document.createTextNode(text) : null;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  if (node.hasAttribute("t-if")) {
    const cond = evalKanbanExpr(node.getAttribute("t-if"), record, scope);
    if (!cond) return null;
  }

  if (node.hasAttribute("t-set")) {
    const varName = node.getAttribute("t-set");
    scope[varName] = evalKanbanExpr(node.getAttribute("t-value"), record, scope);
    return null;
  }

  const tag = node.tagName.toLowerCase();

  if (node.hasAttribute("t-esc") || node.hasAttribute("t-out")) {
    const expr = node.getAttribute("t-esc") || node.getAttribute("t-out");
    const val = evalKanbanExpr(expr, record, scope);
    const text = document.createTextNode(val === undefined || val === null || val === false ? "" : String(val));
    if (tag === "t") return text;
    const el = document.createElement(tag);
    el.appendChild(text);
    return el;
  }

  if (tag === "field") {
    const fname = node.getAttribute("name");
    const val = record[fname]?.value ?? "";
    return document.createTextNode(String(val));
  }

  const container = tag === "t" ? document.createDocumentFragment() : document.createElement(tag);

  if (container.nodeType === Node.ELEMENT_NODE) {
    for (const attr of Array.from(node.attributes)) {
      if (attr.name.startsWith("t-")) continue;
      container.setAttribute(attr.name, attr.value);
    }

    if (node.hasAttribute("t-att-class")) {
      const val = evalKanbanExpr(node.getAttribute("t-att-class"), record, scope);
      if (val) container.className = (container.className ? container.className + " " : "") + val;
    }
    if (node.hasAttribute("t-attf-class")) {
      const val = interpolateAttrf(node.getAttribute("t-attf-class"), record, scope);
      container.className = (container.className ? container.className + " " : "") + val;
    }
    if (tag === "img" && node.hasAttribute("t-att-src")) {
      container.setAttribute("src", kanbanImagePlaceholder());
    }
  }

  for (const child of Array.from(node.childNodes)) {
    const rendered = renderKanbanNode(child, record, fieldsInfo, scope);
    if (rendered) container.appendChild(rendered);
  }

  return container;
}
