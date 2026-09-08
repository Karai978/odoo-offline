/**
 * views/form/notebook_and_header.js
* Notebook rendering (tabs),
 * the header (statusbar + action buttons), and button_box (smart
 * buttons). Depends on:
 * - core/py_js/py_utils.js (isNodeVisible, evaluateSimpleCondition)
 * - fields/field.js (renderField, via renderChildrenInto)
 * - views/form/form_compiler.js (renderChildrenInto, renderNode)
 */

import { isNodeVisible, evaluateSimpleCondition } from "../../core/py_js/py_utils.js";
import { renderChildrenInto, renderNode } from "./form_compiler.js";
import { renderField } from "../../fields/field.js";

export function renderNotebook(node, fieldsInfo, initialValues, securityContext, hasRecordId) {
  const wrapper = document.createElement("div");
  wrapper.className = "o_notebook";

  const nav = document.createElement("div");
  nav.className = "o_notebook_headers";

  const navUl = document.createElement("ul");
  navUl.className = "nav nav-tabs";
  nav.appendChild(navUl);

  const content = document.createElement("div");
  content.className = "tab-content";

  const pages = Array.from(node.children).filter(
    (c) => c.tagName === "page" && isNodeVisible(c, securityContext, initialValues)
  );

  pages.forEach((page, index) => {
    const label = page.getAttribute("string") || `Page ${index + 1}`;

    const li = document.createElement("li");
    li.className = "nav-item";
    const link = document.createElement("a");
    link.className = "nav-link" + (index === 0 ? " active" : "");
    link.href = "#";
    link.textContent = label;
    li.appendChild(link);
    navUl.appendChild(li);

    const pane = document.createElement("div");
    pane.className = "tab-pane" + (index === 0 ? " active" : "");
    renderChildrenInto(page, pane, fieldsInfo, initialValues, securityContext, hasRecordId);
    content.appendChild(pane);

    link.addEventListener("click", (e) => {
      e.preventDefault();
      navUl.querySelectorAll(".nav-link").forEach((l) => l.classList.remove("active"));
      content.querySelectorAll(".tab-pane").forEach((p) => p.classList.remove("active"));
      link.classList.add("active");
      pane.classList.add("active");
    });
  });

  wrapper.appendChild(nav);
  wrapper.appendChild(content);
  return pages.length > 0 ? wrapper : null;
}

/**
 * NEW param: onObjectButtonClick(methodName) — optional callback invoked
 * when a type="object" button is clicked (e.g. action_confirm). Buttons
 * of any other type (type="action", or no type at all) keep the previous
 * "not available offline" behavior unchanged — out of scope for now.
 */
export function renderHeaderInto(node, headerRow, fieldsInfo, initialValues, onObjectButtonClick) {
  const buttonsWrapper = document.createElement("div");
  buttonsWrapper.className = "o_statusbar_buttons d-flex align-items-center align-content-around flex-wrap gap-1";

  const buttons = Array.from(node.children).filter((c) => c.tagName === "button");
  buttons.forEach((btnNode) => {
    const label = btnNode.getAttribute("string");
    if (!label) return;

    const invisibleExpr = btnNode.getAttribute("invisible");
    if (invisibleExpr) {
      const result = evaluateSimpleCondition(invisibleExpr, initialValues);
      if (result === true) return;
    }

    const btnType = btnNode.getAttribute("type");
    const btnName = btnNode.getAttribute("name");

    const btn = document.createElement("button");
    btn.type = "button";
    const isPrimary =
      btnNode.getAttribute("class")?.includes("oe_highlight") ||
      buttonsWrapper.children.length === 0;
    btn.className = "btn " + (isPrimary ? "btn-primary" : "btn-secondary");
    btn.textContent = label;

    // Only type="object" buttons with a valid name and a wired callback
    // are made functional. Everything else (type="action", missing name,
    // no callback provided) keeps the previous placeholder behavior —
    // this scope restriction is intentional (type="action" handled later).
    if (btnType === "object" && btnName && typeof onObjectButtonClick === "function") {
      btn.addEventListener("click", () => onObjectButtonClick(btnName));
    } else {
      btn.title = "Action non disponible hors-ligne pour le moment";
      btn.addEventListener("click", () => {
        alert("Cette action nécessite une connexion à Odoo — non disponible hors-ligne pour le moment.");
      });
    }

    buttonsWrapper.appendChild(btn);
  });

  headerRow.appendChild(buttonsWrapper);

  const statusField = Array.from(node.querySelectorAll("field")).find(
    (f) => f.getAttribute("widget") === "statusbar"
  );

  if (statusField) {
    const fieldName = statusField.getAttribute("name");
    const info = fieldsInfo[fieldName];

    if (info && info.selection) {
      const currentValue = initialValues ? initialValues[fieldName] : undefined;

      const visibleAttr = statusField.getAttribute("statusbar_visible");
      const visibleStates = visibleAttr
        ? visibleAttr.split(",").map((s) => s.trim())
        : null;

      const visibleSelection = info.selection.filter(([value]) => {
        if (!visibleStates) return true;
        return visibleStates.includes(String(value)) || String(value) === String(currentValue);
      });

      const fieldWrapper = document.createElement("div");
      fieldWrapper.setAttribute("name", fieldName);
      fieldWrapper.className = "o_field_widget o_readonly_modifier o_field_statusbar";

      const statusDiv = document.createElement("div");
      statusDiv.className = "o_statusbar_status";
      statusDiv.setAttribute("role", "radiogroup");
      statusDiv.setAttribute("aria-label", "Barre de statut");

      visibleSelection.forEach(([value, label], idx) => {
        const isActive =
          (currentValue !== undefined && String(currentValue) === String(value)) ||
          (currentValue === undefined && idx === 0);
        const isFirst = idx === 0;
        const isLast = idx === info.selection.length - 1;

        const step = document.createElement("button");
        step.type = "button";
        step.className =
          "btn btn-secondary o_arrow_button" +
          (isFirst ? " o_first" : "") +
          (isLast ? " o_last" : "") +
          (isActive ? " o_arrow_button_current" : "");
        step.disabled = true;
        step.setAttribute("role", "radio");
        step.setAttribute("aria-checked", isActive ? "true" : "false");
        if (isActive) step.setAttribute("aria-current", "step");
        step.dataset.value = value;
        step.textContent = label;
        statusDiv.insertBefore(step, statusDiv.firstChild);
      });

      fieldWrapper.appendChild(statusDiv);
      headerRow.appendChild(fieldWrapper);
    }
  }
}

export function renderButtonBox(node, hasRecordId) {
  if (!hasRecordId) return null;

  const wrapper = document.createElement("div");
  wrapper.className = "oe_button_box";

  const buttons = Array.from(node.children).filter((c) => c.tagName === "button");
  buttons.forEach((btnNode) => {
    const label = btnNode.getAttribute("string") || "";
    if (!label) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "oe_stat_button btn";
    btn.innerHTML = `<div class="o_stat_info"><span class="o_stat_text">${label}</span></div>`;
    wrapper.appendChild(btn);
  });

  return wrapper.children.length > 0 ? wrapper : null;
}