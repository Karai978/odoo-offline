/**
 * views/relational_model/dynamic_field_attrs.js
 */

import { evaluateSimpleCondition } from "../../core/py_js/py_utils.js";

/**
 * Applies the dynamic readonly/required attributes of a <field> node
 * to the generated HTML element. inputEl can be a direct <input>/<select>,
 * or a wrapper <div> (many2one, one2many, boolean).
 */
export function applyDynamicAttrs(node, inputEl, currentValues) {
  if (!inputEl) return;

  const readonlyExpr = node.getAttribute("readonly");
  if (readonlyExpr === "1" || readonlyExpr === "True") {
    markReadonly(inputEl);
  } else if (readonlyExpr) {
    const result = evaluateSimpleCondition(readonlyExpr, currentValues);
    if (result === true) markReadonly(inputEl);
  }

  const requiredExpr = node.getAttribute("required");
  if (requiredExpr && requiredExpr !== "1" && requiredExpr !== "True") {
    const result = evaluateSimpleCondition(requiredExpr, currentValues);
    if (result === true) markRequired(inputEl);
  }
}

export function markReadonly(el) {
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") {
    if (el.type === "checkbox") {
      el.disabled = true;
    } else {
      el.readOnly = true;
      el.style.backgroundColor = "#f5f5f5";
    }
    return;
  }
  el.querySelectorAll("input, select, textarea, button, a").forEach((child) => {
    child.disabled = true;
    child.style.pointerEvents = "none";
  });
  el.style.opacity = "0.7";
}

export function markRequired(el) {
  if ("required" in el) {
    el.required = true;
  } else {
    el.querySelectorAll("input, select, textarea").forEach((child) => {
      if ("required" in child) child.required = true;
    });
  }
}

/**
 * Resets previously applied dynamic attributes before
 * re-evaluation (otherwise, a field that has become editable again would remain locked).
 */
export function resetDynamicAttrs(el, baseRequired) {
  if (!el) return;

  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") {
    if (el.type === "checkbox") {
      el.disabled = false;
    } else {
      el.readOnly = false;
      el.style.backgroundColor = "";
    }
    el.required = !!baseRequired;
    return;
  }

  el.querySelectorAll("input, select, textarea, button, a").forEach((child) => {
    child.disabled = false;
    child.style.pointerEvents = "";
    if ("required" in child) child.required = !!baseRequired;
  });
  el.style.opacity = "";
}
