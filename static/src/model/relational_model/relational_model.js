/**
 * model/relational_model/relational_model.js.
 * Hooks up the live re-evaluation of dynamic attributes (readonly/
 * required) for the entire form: on every input event, the current
 * values ​​are read and the rules for each relevant <field>
 * are re-applied.
 */

import { applyDynamicAttrs, resetDynamicAttrs } from "./dynamic_field_attrs.js";
import { collectFormData } from "../../views/form/form_serializer.js";
import { onchangeRegistry } from "./business_rules_registry.js";

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

      const wrapperEl = containerEl.querySelector(`[data-field-row="${fieldName}"] .o_field_widget`)
        || containerEl.querySelector(`[data-field-value="${fieldName}"]`)?.closest(".o_field_widget");
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

/**
 * Rejoue, au changement d'un champ, l'équivalent JS explicite d'un
 * @api.onchange Python enregistré pour ce modèle (voir
 * business_rules_registry.js). Ne couvre QUE les modèles/champs
 * explicitement enregistrés — pour tout le reste, comportement inchangé
 * (pas d'auto-remplissage, comme avant cette fonctionnalité).
 *
 * @returns {Function} Cleanup function (à appeler au démontage du formulaire).
 */
export function attachLiveOnchange(model, containerEl, fieldsInfo, helpers) {
  const entries = onchangeRegistry.getEntries().filter(([key]) => key.startsWith(`${model}:`));
  if (entries.length === 0) return () => {};

  function applyPatch(patch) {
    for (const [fieldName, value] of Object.entries(patch)) {
      const rowEl = containerEl.querySelector(`[data-field-row="${fieldName}"]`)
        || containerEl.querySelector(`[data-field-value="${fieldName}"]`)?.closest("[data-field-row]");
      if (!rowEl) continue;

      const finfo = fieldsInfo[fieldName];
      if (finfo && finfo.type === "many2one") {
        // Keep the visible label, canonical relation ID, radio choices, and
        // avatar/badge presentation in sync for all many2one widgets.
        const normalized = Array.isArray(value)
          ? { id: value[0], display_name: value[1] }
          : value && typeof value === "object"
            ? value
            : value
              ? { id: value, display_name: `#${value}` }
              : null;
        const selectedId = normalized?.id == null || normalized.id === false ? "" : normalized.id;
        const displayName = normalized?.display_name == null || normalized.display_name === false
          ? ""
          : String(normalized.display_name);
        const hiddenId = rowEl.querySelector(`input[name="${fieldName}_id"]`);
        const visibleInput = rowEl.querySelector(`input#field-${fieldName}`);
        if (hiddenId) hiddenId.value = selectedId;
        if (visibleInput) visibleInput.value = displayName;
        rowEl.querySelectorAll(`input[type="radio"][name="${fieldName}__radio"]`).forEach((radio) => {
          radio.checked = String(radio.value) === String(selectedId);
        });
        const badge = rowEl.querySelector(".o_field_badge .badge");
        if (badge) badge.textContent = displayName;
        const avatar = rowEl.querySelector(".o_field_many2one_avatar .o_avatar");
        if (avatar) {
          avatar.textContent = String(displayName || "?").trim().split(/\s+/).filter(Boolean)
            .slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
        }
      } else if (finfo && finfo.type === "many2many") {
        const widget = rowEl.querySelector(".o_field_widget")?.firstElementChild;
        if (typeof widget?._setFieldValue === "function") {
          widget._setFieldValue(value);
        } else {
          const hidden = rowEl.querySelector(`input[name="${fieldName}"]`);
          if (!hidden) continue;
          const ids = Array.isArray(value)
            ? value.map((item) => Array.isArray(item) ? item[0] : (item && typeof item === "object" ? item.id : item))
            : [];
          hidden.value = JSON.stringify(ids);
        }
      } else {
        const widget = rowEl.querySelector(".o_field_widget")?.firstElementChild;
        if (typeof widget?._setFieldValue === "function") {
          widget._setFieldValue(value);
          continue;
        }
        const input = rowEl.querySelector(`[id="field-${fieldName}"]`)
          || rowEl.querySelector(`[data-field-value="${fieldName}"]`)
          || rowEl.querySelector("input, select, textarea");
        if (!input) continue;
        if (input.type === "checkbox") {
          input.checked = !!value;
        } else if (input.dataset.fieldWidget === "float_factor") {
          const factor = Number(input.dataset.factor) || 1;
          input.value = value == null || value === false ? "" : Number(value) * factor;
        } else {
          input.value = value ?? "";
        }
      }
    }
  }

  async function handler(e) {
    const rowEl = e.target?.closest("[data-field-row]");
    const fieldName = e.target?.dataset?.fieldValue || rowEl?.dataset.fieldRow;
    if (!fieldName) return;

    // Une clé sans "#" (ex. "sale.order:partner_id") reste une règle unique
    // sur ce champ. Une clé avec "#discriminant" (ex.
    // "sale.order:company_id#require_signature") permet à PLUSIEURS règles
    // indépendantes de se déclencher sur le même champ.
    const matches = entries.filter(
      ([key]) => key === `${model}:${fieldName}` || key.startsWith(`${model}:${fieldName}#`)
    );
    if (matches.length === 0) return;

    const currentValues = collectFormData(containerEl, fieldsInfo);
    const mergedPatch = {};
    for (const [key, fn] of matches) {
      try {
        const patch = await fn(currentValues[fieldName], currentValues, helpers);
        if (patch) Object.assign(mergedPatch, patch);
      } catch (err) {
        console.warn(`Onchange local échoué pour ${key}:`, err);
      }
    }
    if (Object.keys(mergedPatch).length > 0) applyPatch(mergedPatch);
  }

  containerEl.addEventListener("change", handler);
  return () => containerEl.removeEventListener("change", handler);
}