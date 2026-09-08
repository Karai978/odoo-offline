/**
 * views/list/list_renderer_utils.js
 * Rendering and formatting of list view cells, used as-is by the
 * Kanban engine (views/kanban/kanban_renderer.js). 
*/

import { evaluateSimpleCondition } from "../../core/py_js/py_utils.js";

/**
 * Renders a cell based on the field type, replicating actual Odoo
 * styles: colored badges for selection fields (via decoration-*),
 * bold amounts for monetary/float fields, etc.
 */
export function renderListCell(record, col, info) {
  const value = record[col.field];

  if (!info) {
    const span = document.createElement("span");
    span.textContent = formatCellValue(value, info);
    return span;
  }

  if (info.type === "selection") {
    const found = (info.selection || []).find(([v]) => String(v) === String(value));
    const label = found ? found[1] : String(value || "");

    const badge = document.createElement("span");
    badge.className = "badge rounded-pill " + getDecorationClass(col.node, record);
    badge.textContent = label;
    return badge;
  }

  if (info.type === "monetary" || info.type === "float") {
    const span = document.createElement("span");
    span.className = "fw-bold";
    span.textContent = value ? Number(value).toFixed(2) : "0.00";
    return span;
  }

  if (info.type === "many2one") {
    const span = document.createElement("span");
    span.textContent = Array.isArray(value) ? value[1] : (value || "");
    return span;
  }

  if (info.type === "boolean") {
    const span = document.createElement("span");
    span.textContent = value ? "✓" : "";
    return span;
  }

  const span = document.createElement("span");
  span.textContent = formatCellValue(value, info);
  return span;
}

/**
 * Reads the decoration-info/success/danger/warning/muted attributes of the
 * <field> in the arch and evaluates their conditions to select the badge
 * color, exactly as the actual Odoo web client does.
 */
export function getDecorationClass(fieldNode, record) {
  if (!fieldNode) return "text-bg-secondary";

  const decorations = ["success", "info", "warning", "danger", "muted", "primary"];
  for (const color of decorations) {
    const expr = fieldNode.getAttribute(`decoration-${color}`);
    if (expr) {
      const result = evaluateSimpleCondition(expr, record);
      if (result === true) return `text-bg-${color}`;
    }
  }
  return "text-bg-secondary";
}

/** 
 * Format a raw value into readable text based on the field type.
 * Used by both the list view and the Kanban engine. 
*/
export function formatCellValue(value, info) {
  if (value === false || value === undefined || value === null) return "";
  if (!info) return String(value);

  switch (info.type) {
    case "many2one":
      return Array.isArray(value) ? value[1] : String(value);
    case "boolean":
      return value ? "✓" : "";
    case "selection": {
      const found = (info.selection || []).find(([v]) => String(v) === String(value));
      return found ? found[1] : String(value);
    }
    default:
      return String(value);
  }
}
