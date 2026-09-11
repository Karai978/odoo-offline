/**
 * views/form/form_compiler.js
 * Recursively compiles the XML architecture of an Odoo form into DOM elements,
 * dispatching each node to the appropriate renderer.
 */

import { isNodeVisible } from "../../core/py_js/py_utils.js";
import { renderNotebook } from "../../core/notebook/notebook.js";
import { renderHeaderInto } from "./status_bar_buttons/status_bar_buttons.js";
import { renderButtonBox } from "./button_box/button_box.js";
import { renderGroup } from "./form_group/form_group.js";
import { renderField } from "../fields/field.js";

/**
 * NEW param: onObjectButtonClick, threaded through to renderHeaderInto
 * only (the only place where type="object" buttons currently render —
 * see status_bar_buttons/status_bar_buttons.js).
 */
export function renderChildren(xmlNode, headerRow, sheet, fieldsInfo, initialValues, securityContext, hasRecordId, onObjectButtonClick) {
  for (const child of xmlNode.children) {
    if (child.tagName === "header") {
      renderHeaderInto(child, headerRow, fieldsInfo, initialValues, onObjectButtonClick);
      continue;
    }
    const rendered = renderNode(child, fieldsInfo, initialValues, securityContext, hasRecordId);
    if (rendered) sheet.appendChild(rendered);
  }
}

export function renderChildrenInto(xmlNode, htmlParent, fieldsInfo, initialValues, securityContext, hasRecordId) {
  for (const child of xmlNode.children) {
    const rendered = renderNode(child, fieldsInfo, initialValues, securityContext, hasRecordId);
    if (rendered) htmlParent.appendChild(rendered);
  }
}

export function renderNode(node, fieldsInfo, initialValues, securityContext, hasRecordId) {
  if (!isNodeVisible(node, securityContext, initialValues)) return null;

  const classAttr = node.getAttribute("class") || "";

  switch (node.tagName) {
    case "sheet":
      return renderPassthrough(node, fieldsInfo, initialValues, securityContext, hasRecordId);
    case "group":
      return renderGroup(node, fieldsInfo, initialValues, securityContext, hasRecordId);
    case "notebook":
      return renderNotebook(node, fieldsInfo, initialValues, securityContext, hasRecordId);
    case "page":
      return renderPassthrough(node, fieldsInfo, initialValues, securityContext, hasRecordId, "tab-pane");
    case "field":
      return renderField(node, fieldsInfo, initialValues, securityContext, hasRecordId);
    case "label":
      return renderLabel(node);
    case "div":
      if (classAttr.includes("oe_button_box")) {
        return renderButtonBox(node, hasRecordId);
      }
      return renderPassthrough(node, fieldsInfo, initialValues, securityContext, hasRecordId);
    case "h1": {
      const el = document.createElement("h1");
      el.className = "o_row";
      for (const child of node.children) {
        if (!isNodeVisible(child, securityContext, initialValues)) continue;
        if (child.tagName === "field") {
          const rendered = renderField(child, fieldsInfo, initialValues, securityContext, hasRecordId);
          if (rendered) {
            const label = rendered.querySelector(".o_form_label");
            if (label) label.remove();
            el.appendChild(rendered);
          }
        } else {
          const rendered = renderNode(child, fieldsInfo, initialValues, securityContext, hasRecordId);
          if (rendered) el.appendChild(rendered);
        }
      }
      return el.children.length > 0 ? el : null;
    }
    case "button":
    case "widget":
      return null;
    default:
      return renderPassthrough(node, fieldsInfo, initialValues, securityContext, hasRecordId);
  }
}

function renderPassthrough(node, fieldsInfo, initialValues, securityContext, hasRecordId, extraClass = "") {
  const el = document.createElement("div");
  if (extraClass) el.className = extraClass;
  renderChildrenInto(node, el, fieldsInfo, initialValues, securityContext, hasRecordId);
  return el.children.length > 0 ? el : null;
}

function renderLabel(node) {
  const forAttr = node.getAttribute("for");
  const stringAttr = node.getAttribute("string");
  const el = document.createElement("label");
  el.className = "o_form_label";
  if (forAttr) el.setAttribute("for", `field-${forAttr}`);
  el.textContent = stringAttr || forAttr || "";
  return el;
}