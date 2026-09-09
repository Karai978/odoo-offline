/**
 * views/form/form_serializer.js
 * Serializes the current DOM state of a rendered form into a values ​​object, ready to
 * be sent via core/network/rpc_service.js.
 */

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

    const el = container.querySelector(`#field-${fieldName}`);
    if (!el) continue;
    data[fieldName] = getElementValue(el, info);
  }

  return data;
}

export function getElementValue(el, info) {
  switch (info.type) {
    case "boolean":
      return el.checked;
    case "integer":
      return el.value ? parseInt(el.value, 10) : false;
    case "float":
      return el.value ? parseFloat(el.value) : false;
    case "monetary":
      return el.value ? parseFloat(el.value) : false;
    case "many2one": {
      const hidden = el.querySelector('input[type="hidden"]');
      const rawVal = hidden ? hidden.value : "";
      return rawVal
        ? (rawVal.startsWith("tmp:") ? rawVal : parseInt(rawVal, 10))
        : false;
    }
    case "many2many": {
      const hidden = el.querySelector('input[type="hidden"]');
      if (!hidden || !hidden.value) return [];
      try {
        return JSON.parse(hidden.value);
      } catch (e) {
        return [];
      }
    }
    case "date":
      return el.value || false;
    default:
      return el.value || false;
  }
}
