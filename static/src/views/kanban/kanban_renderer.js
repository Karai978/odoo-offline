/**
 * views/kanban/kanban_renderer.js
* Mini QWeb engine
 * for templates <t t-name="kanban-box"> (t-if, t-esc, t-out,
 * t-attf-class, t-set...).
 */

import { formatCellValue } from "../list/list_renderer_utils.js";

function buildKanbanRecordProxy(record, fieldsInfo) {
  const proxy = {};
  for (const [fname, info] of Object.entries(fieldsInfo)) {
    const rawValue = record[fname];
    proxy[fname] = {
      raw_value: rawValue === undefined ? false : rawValue,
      value: formatCellValue(rawValue, info),
    };
  }
  if (proxy.id === undefined) {
    proxy.id = { raw_value: record.id, value: record.id };
  }
  return proxy;
}

function translatePythonExpr(expr) {
  return expr
    .replace(/\bnot\s+/g, "!")
    .replace(/\band\b/g, "&&")
    .replace(/\bor\b/g, "||")
    .replace(/\bTrue\b/g, "true")
    .replace(/\bFalse\b/g, "false")
    .replace(/\bNone\b/g, "null");
}

function evalKanbanExpr(expr, record, scope) {
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

function renderKanbanNode(node, record, fieldsInfo, scope) {
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

const KANBAN_GLOBAL_DEFAULTS = {
  selection_mode: false,
};

export function renderKanbanView(archXml, fieldsInfo, records, onCardClick) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(archXml, "text/xml");

  const kanbanRoot = doc.querySelector("kanban");
  const templateNode = doc.querySelector('templates > t[t-name="kanban-box"]');

  const wrapper = document.createElement("div");
  wrapper.className = "o_kanban_view o_kanban_ungrouped";

  if (!kanbanRoot || !templateNode) {
    wrapper.textContent = "Vue Kanban non disponible pour ce modèle.";
    return wrapper;
  }

  if (!records || records.length === 0) {
    const empty = document.createElement("div");
    empty.className = "o_kanban_renderer o_kanban_no_records text-muted p-4 text-center";
    empty.textContent = "Aucun enregistrement.";
    wrapper.appendChild(empty);
    return wrapper;
  }

  const renderer = document.createElement("div");
  renderer.className = "o_kanban_renderer o_kanban_grouped d-flex flex-wrap gap-3 p-3";
  wrapper.appendChild(renderer);

  records.forEach((rawRecord) => {
    const recordProxy = buildKanbanRecordProxy(rawRecord, fieldsInfo);
    const scope = { ...KANBAN_GLOBAL_DEFAULTS };

    const cardWrapper = document.createElement("div");
    cardWrapper.className = "o_kanban_record";
    cardWrapper.style.width = "300px";
    cardWrapper.style.cursor = "pointer";

    for (const child of Array.from(templateNode.childNodes)) {
      const rendered = renderKanbanNode(child, recordProxy, fieldsInfo, scope);
      if (rendered) cardWrapper.appendChild(rendered);
    }

    cardWrapper.addEventListener("click", () => onCardClick(rawRecord.id));
    renderer.appendChild(cardWrapper);
  });

  return wrapper;
}
