/** Odoo date and date-related widgets. */
import { getFieldOptions, makeHiddenFieldInput } from "../field_utils.js";

function isoToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function renderDateField(name, info, node, initialValue) {
  const input = document.createElement("input");
  input.type = "date";
  input.className = "o_input";
  input.id = `field-${name}`;
  input.name = name;
  input.placeholder = node?.getAttribute("placeholder") || "";
  if (info.required) input.required = true;
  if (initialValue) input.value = initialValue;

  const options = getFieldOptions(node);
  if (options.min_date) input.min = options.min_date === "today" ? isoToday() : String(options.min_date).slice(0, 10);
  if (options.max_date) input.max = options.max_date === "today" ? isoToday() : String(options.max_date).slice(0, 10);
  return input;
}

/**
 * Date range control. Odoo architectures put either start_date_field or
 * end_date_field in the options; both values remain ordinary date inputs in
 * the form serializer, so the existing offline write path is reused.
 */
export function renderDateRangeField(name, info, node, initialValue, initialValues = {}) {
  // A one2many cell uses a generated control name; do not create companion
  // controls with duplicate IDs from the parent list architecture.
  const archFieldName = node?.getAttribute("name");
  if (archFieldName && archFieldName !== name) {
    const input = document.createElement("input");
    input.type = info.type === "datetime" ? "datetime-local" : "date";
    input.className = "o_input";
    input.id = `field-${name}`;
    input.name = name;
    if (info.required) input.required = true;
    if (initialValue) input.value = initialValue;
    return input;
  }
  const options = getFieldOptions(node);
  const startField = options.start_date_field;
  const endField = options.end_date_field;
  const currentField = node?.getAttribute("name") || name;
  const currentIsEnd = startField && endField
    ? currentField === endField || currentField !== startField
    : !!startField;
  const peerName = currentIsEnd ? startField : endField;
  if (!peerName || typeof peerName !== "string" || peerName === currentField) {
    if (info.type !== "datetime") return renderDateField(name, info, node, initialValue);
    const input = document.createElement("input");
    input.type = "datetime-local";
    input.className = "o_input";
    input.id = `field-${name}`;
    input.name = name;
    if (info.required) input.required = true;
    if (initialValue) input.value = initialValue;
    return input;
  }

  const inputType = info.type === "datetime" ? "datetime-local" : "date";
  const startName = currentIsEnd ? peerName : name;
  const endName = currentIsEnd ? name : peerName;
  const startValue = currentIsEnd ? initialValues[startName] : initialValue;
  const endValue = currentIsEnd ? initialValue : initialValues[endName];

  const wrapper = document.createElement("div");
  wrapper.className = "o_field_daterange d-flex flex-wrap align-items-center gap-2";

  const startInput = document.createElement("input");
  startInput.type = inputType;
  startInput.className = "o_input";
  if (startName === name) startInput.id = `field-${name}`;
  else startInput.dataset.fieldValue = startName;
  startInput.name = startName;
  startInput.setAttribute("aria-label", "Date de début");
  if (startValue) startInput.value = startValue;

  const separator = document.createElement("span");
  separator.className = "text-muted";
  separator.textContent = "→";
  separator.setAttribute("aria-hidden", "true");

  const endInput = document.createElement("input");
  endInput.type = inputType;
  endInput.className = "o_input";
  if (endName === name) endInput.id = `field-${name}`;
  else endInput.dataset.fieldValue = endName;
  endInput.name = endName;
  endInput.setAttribute("aria-label", "Date de fin");
  if (endValue) endInput.value = endValue;
  if (info.required) (currentIsEnd ? endInput : startInput).required = true;

  wrapper.append(startInput, separator, endInput);

  // If the companion field is separately rendered elsewhere in the form,
  // keep its control synchronized as well. The companion uses data-field-value
  // (rather than a duplicate ID) when it has no separate form row.
  const syncPeer = (fieldName, value) => {
    const form = wrapper.closest(".o_form_view");
    const rows = form?.querySelectorAll(`[data-field-row="${fieldName}"]`) || [];
    for (const row of rows) {
      const separateInput = row.querySelector("input, select, textarea");
      if (separateInput && separateInput !== startInput && separateInput !== endInput) {
        separateInput.value = value;
      }
    }
  };
  startInput.addEventListener("change", () => syncPeer(startName, startInput.value));
  endInput.addEventListener("change", () => syncPeer(endName, endInput.value));
  return wrapper;
}

/** Readonly `remaining_days`; edit mode remains a regular date input. */
export function renderRemainingDaysField(name, info, node, initialValue) {
  const readonly = ["1", "True", "true"].includes(node?.getAttribute("readonly"));
  if (!readonly) {
    if (info.type !== "datetime") return renderDateField(name, info, node, initialValue);
    const input = document.createElement("input");
    input.type = "datetime-local";
    input.className = "o_input";
    input.id = `field-${name}`;
    input.name = name;
    if (info.required) input.required = true;
    if (initialValue) input.value = initialValue;
    return input;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "o_field_remaining_days";
  const hiddenInput = makeHiddenFieldInput(name, initialValue);
  wrapper.appendChild(hiddenInput);
  const text = document.createElement("span");
  wrapper.appendChild(text);

  wrapper._setFieldValue = (value) => {
    hiddenInput.value = value === false || value == null ? "" : String(value);
    if (!value) {
      text.textContent = "";
      return;
    }
    const target = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(target.getTime())) {
      text.textContent = String(value);
      return;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.round((target.getTime() - today.getTime()) / 86400000);
    text.className = days < 0 ? "text-danger" : "text-muted";
    text.textContent = days === 0
      ? "Aujourd'hui"
      : days > 0
        ? `Dans ${days} jour${days === 1 ? "" : "s"}`
        : `Il y a ${Math.abs(days)} jour${days === -1 ? "" : "s"}`;
  };
  wrapper._setFieldValue(initialValue);
  return wrapper;
}

/**
 * Converts an ISO date (yyyy-mm-dd, Odoo format) to French dd/mm/yyyy.
 */
export function isoToDisplayDate(isoValue) {
  if (!isoValue) return "";
  const [year, month, day] = isoValue.split("-");
  if (!year || !month || !day) return "";
  return `${day}/${month}/${year}`;
}

/** Converts dd/mm/yyyy back to the ISO format (yyyy-mm-dd) expected by Odoo. */
export function displayDateToIso(displayValue) {
  if (!displayValue) return false;
  const [day, month, year] = displayValue.split("/");
  if (!day || !month || !year) return false;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}
