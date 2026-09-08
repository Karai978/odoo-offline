/**
 * views/relational_model/relational_model.js.
 * Hooks up the live re-evaluation of dynamic attributes (readonly/
 * required) for the entire form: on every input event, the current
 * values ​​are read and the rules for each relevant <field>
 * are re-applied.
 */

import { applyDynamicAttrs, resetDynamicAttrs } from "./dynamic_field_attrs.js";
import { collectFormData } from "../form/form_serializer.js";

/**
 * @returns {Function} Cleanup function to be called when the form is
 * unmounted (removes the "input"/"change" listeners attached here).
 */
export function attachLiveBusinessRules(archXmlString, containerEl, fieldsInfo) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(archXmlString, "application/xml");
  const root = xmlDoc.documentElement;

  const dynamicFieldNodes = Array.from(root.querySelectorAll("field")).filter((node) => {
    return ["readonly", "required"].some((key) => {
      const raw = node.getAttribute(key);
      return raw && raw !== "1" && raw !== "True";
    });
  });

  if (dynamicFieldNodes.length === 0) return () => {};

  const revaluateAll = () => {
    const currentValues = collectFormData(containerEl, fieldsInfo);

    dynamicFieldNodes.forEach((node) => {
      const fieldName = node.getAttribute("name");
      if (!fieldName) return;

      const wrapperEl = containerEl.querySelector(`[data-field-row="${fieldName}"] .o_field_widget`);
      if (!wrapperEl) return;

      const info = fieldsInfo[fieldName];
      const baseRequired = info ? !!info.required : false;

      resetDynamicAttrs(wrapperEl, baseRequired);
      applyDynamicAttrs(node, wrapperEl, currentValues);
    });
  };

  containerEl.addEventListener("input", revaluateAll);
  containerEl.addEventListener("change", revaluateAll);

  return () => {
    containerEl.removeEventListener("input", revaluateAll);
    containerEl.removeEventListener("change", revaluateAll);
  };
}
