/**
 * Serialize the current form DOM into values accepted by the offline write
 * queue. Widget-specific presentation is normalized back to Odoo field data.
 */
import { parseFloatTime } from "../fields/float/float_field.js";

export function collectFormData(container, fieldsInfo) {
  const data = {};

  for (const [fieldName, info] of Object.entries(fieldsInfo)) {
    if (info.type === "many2one") {
      const hiddenInput = container.querySelector(`input[name="${fieldName}_id"]`);
      const rawVal = hiddenInput ? hiddenInput.value : "";
      data[fieldName] = rawVal
        ? (rawVal.startsWith("tmp:") ? rawVal : parseInt(rawVal, 10))
        : false;
      continue;
    }

    if (info.type === "one2many") {
      const fieldWrapper = container.querySelector(`[data-one2many="${fieldName}"] [data-o2m-root="true"]`);
      if (!fieldWrapper) {
        data[fieldName] = [];
        continue;
      }
      const rows = Array.from(fieldWrapper._getTbody().querySelectorAll("tr")).filter((tr) => tr._cellRefs);

      const lines = [];
      const currentIds = new Set();

      rows.forEach((tr) => {
        const rowValues = {};
        for (const [col, ref] of Object.entries(tr._cellRefs)) {
          rowValues[col] = getElementValue(ref.el, ref.info);
        }
        if (tr._recordId) {
          currentIds.add(tr._recordId);
          rowValues.id = tr._recordId;
        }
        lines.push(rowValues);
      });

      const initialIds = fieldWrapper._initialLineIds || new Set();
      for (const id of initialIds) {
        if (!currentIds.has(id)) {
          lines.push({ id, _deleted: true });
        }
      }

      data[fieldName] = lines;
      continue;
    }

    if (info.type === "many2many") {
      const hiddenInput = container.querySelector(`input[name="${fieldName}"]`);
      let ids = [];
      if (hiddenInput && hiddenInput.value) {
        try {
          ids = JSON.parse(hiddenInput.value);
        } catch (e) {
          ids = [];
        }
      }
      data[fieldName] = ids;
      continue;
    }

    const el = container.querySelector(`[id="field-${fieldName}"]`)
      || container.querySelector(`[data-field-value="${fieldName}"]`);
    if (!el) continue;
    data[fieldName] = getElementValue(el, info);
  }

  return data;
}

function getControlElement(element) {
  if (!element) return null;
  if (["INPUT", "SELECT", "TEXTAREA"].includes(element.tagName)) return element;
  return element.querySelector("input[type=checkbox]")
    || element.querySelector("input, select, textarea");
}

export function getElementValue(element, info) {
  if (info.type === "many2one") {
    const hidden = element?.querySelector?.('input[type="hidden"]');
    const rawVal = hidden ? hidden.value : "";
    return rawVal ? (rawVal.startsWith("tmp:") ? rawVal : parseInt(rawVal, 10)) : false;
  }
  if (info.type === "many2many") {
    const hidden = element?.querySelector?.('input[type="hidden"]');
    if (!hidden || !hidden.value) return [];
    try {
      return JSON.parse(hidden.value);
    } catch (e) {
      return [];
    }
  }

  const control = getControlElement(element);
  if (!control) return false;
  if (info.type === "boolean") return !!control.checked;

  const raw = control.value;
  if (raw === "") return false;

  switch (info.type) {
    case "integer":
      return Number.isFinite(parseInt(raw, 10)) ? parseInt(raw, 10) : false;
    case "float": {
      if (control.dataset.fieldWidget === "float_time") return parseFloatTime(raw);
      const value = Number.parseFloat(raw);
      if (!Number.isFinite(value)) return false;
      if (control.dataset.fieldWidget === "float_factor") {
        const factor = Number(control.dataset.factor) || 1;
        return value / factor;
      }
      return value;
    }
    case "monetary": {
      const value = Number.parseFloat(raw);
      return Number.isFinite(value) ? value : false;
    }
    case "date":
    case "datetime":
      return raw || false;
    default:
      return raw || false;
  }
}
