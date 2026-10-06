/**
 * model/relational_model/dynamic_field_attrs.js
 */

import { evaluateSimpleCondition } from "../../core/py_js/py_utils.js";
import { updateCharField } from "../../views/fields/char/char_field.js";

function isStaticTrue(value) {
  return value === "1" || value === "True" || value === "true";
}

function updateOwlCharFields(root, patch) {
  if (!root) return false;
  const hosts = [];
  if (root.matches?.("[data-owl-char-field]")) hosts.push(root);
  root.querySelectorAll?.("[data-owl-char-field]").forEach((host) => hosts.push(host));
  for (const host of hosts) updateCharField(host, patch);
  return hosts.length > 0;
}

/**
 * Applies the dynamic readonly/required attributes of a <field> node
 * to the generated HTML element. inputEl can be a direct input/select,
 * a wrapper div (many2one, one2many, boolean), or the OWL char-field host.
 */
export function applyDynamicAttrs(node, inputEl, currentValues) {
  if (!inputEl) return;

  const readonlyExpr = node.getAttribute("readonly");
  if (isStaticTrue(readonlyExpr)) {
    markReadonly(inputEl);
  } else if (readonlyExpr) {
    const result = evaluateSimpleCondition(readonlyExpr, currentValues);
    if (result === true) markReadonly(inputEl);
  }

  const requiredExpr = node.getAttribute("required");
  if (isStaticTrue(requiredExpr)) {
    markRequired(inputEl);
  } else if (requiredExpr) {
    const result = evaluateSimpleCondition(requiredExpr, currentValues);
    if (result === true) markRequired(inputEl);
  }
}

export function markReadonly(el) {
  if (updateOwlCharFields(el, { readonly: true })) return;

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
  updateOwlCharFields(el, { required: true });

  if ("required" in el) {
    el.required = true;
  } else {
    el.querySelectorAll("input, select, textarea").forEach((child) => {
      if ("required" in child) child.required = true;
    });
  }
}

/**
 * Resets previously applied dynamic attributes before re-evaluation (otherwise,
 * a field that has become editable again would remain locked).
 */
export function resetDynamicAttrs(el, baseRequired, baseReadonly = false) {
  if (!el) return;

  if (updateOwlCharFields(el, { readonly: !!baseReadonly, required: !!baseRequired })) return;

  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") {
    if (el.type === "checkbox") {
      el.disabled = !!baseReadonly;
    } else {
      el.readOnly = !!baseReadonly;
      el.style.backgroundColor = baseReadonly ? "#f5f5f5" : "";
    }
    el.required = !!baseRequired;
    return;
  }

  el.querySelectorAll("input, select, textarea, button, a").forEach((child) => {
    if (child.type === "checkbox") {
      child.disabled = !!baseReadonly;
    } else {
      child.disabled = false;
      if ("readOnly" in child) child.readOnly = !!baseReadonly;
      child.style.backgroundColor = baseReadonly ? "#f5f5f5" : "";
    }
    child.style.pointerEvents = baseReadonly ? "none" : "";
    if ("required" in child) child.required = !!baseRequired;
  });
  el.style.opacity = baseReadonly ? "0.7" : "";
}
