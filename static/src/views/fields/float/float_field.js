/**
 * Float widgets used by Odoo 17 views.
 */
import { getFieldOptions, makeHiddenFieldInput, setFieldInputValue } from "../field_utils.js";

export function renderFloatField(name, info, node, initialValue) {
  const input = document.createElement("input");
  const options = getFieldOptions(node);
  input.type = options.type === "number" ? "number" : "text";
  input.step = String(options.step ?? "any");
  input.className = "o_input";
  input.id = `field-${name}`;
  input.name = name;
  input.placeholder = node?.getAttribute("placeholder") || "";
  if (info.required) input.required = true;
  if (initialValue !== undefined && initialValue !== false && initialValue !== null) input.value = initialValue;
  return input;
}

/** Converts stored decimal hours to/from Odoo's H:MM `float_time` format. */
export function formatFloatTime(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  const sign = number < 0 ? "-" : "";
  const absoluteMinutes = Math.round(Math.abs(number) * 60);
  const hours = Math.floor(absoluteMinutes / 60);
  const minutes = absoluteMinutes % 60;
  return `${sign}${hours}:${String(minutes).padStart(2, "0")}`;
}

export function parseFloatTime(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return false;
  const match = raw.match(/^(-)?(\d+)(?::([0-5]?\d))?$/);
  if (!match) return Number.isFinite(Number(raw)) ? Number(raw) : false;
  const sign = match[1] ? -1 : 1;
  return sign * (Number(match[2]) + Number(match[3] || 0) / 60);
}

export function renderFloatTimeField(name, info, node, initialValue) {
  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "decimal";
  input.className = "o_input";
  input.id = `field-${name}`;
  input.name = name;
  input.dataset.fieldWidget = "float_time";
  input.placeholder = node?.getAttribute("placeholder") || "";
  if (info.required) input.required = true;
  if (initialValue !== undefined && initialValue !== false && initialValue !== null && initialValue !== "") {
    input.value = formatFloatTime(initialValue);
  }
  input._setFieldValue = (value) => {
    input.value = value === false || value == null || value === "" ? "" : formatFloatTime(value);
  };
  return input;
}

/** Value is edited as value * factor and converted back when serialized. */
export function renderFloatFactorField(name, info, node, initialValue) {
  const options = getFieldOptions(node);
  const factor = Number(options.factor ?? 1);
  const safeFactor = Number.isFinite(factor) && factor !== 0 ? factor : 1;
  const input = document.createElement("input");
  input.type = "number";
  input.step = String(options.step ?? "any");
  input.className = "o_input";
  input.id = `field-${name}`;
  input.name = name;
  input.dataset.fieldWidget = "float_factor";
  input.dataset.factor = String(safeFactor);
  if (info.required) input.required = true;
  if (initialValue !== undefined && initialValue !== false && initialValue !== null) {
    input.value = Number(initialValue) * safeFactor;
  }
  input._setFieldValue = (value) => {
    input.value = value === false || value == null || value === "" ? "" : Number(value) * safeFactor;
  };
  return input;
}

/** A finite button/range selector for float fields. */
export function renderFloatToggleField(name, info, node, initialValue) {
  const wrapper = document.createElement("div");
  wrapper.className = "o_field_float_toggle d-flex flex-wrap gap-1";
  const options = getFieldOptions(node);
  const factor = Number(options.factor ?? 1) || 1;
  const range = Array.isArray(options.range) ? options.range : [];
  const input = makeHiddenFieldInput(name, initialValue);
  wrapper.appendChild(input);

  if (range.length === 0) {
    return renderFloatField(name, info, node, initialValue);
  }

  const buttons = [];
  function updateButtons(value) {
    input.value = value === false || value == null ? "" : String(value);
    buttons.forEach((button) => {
      const active = Number(button.dataset.storedValue) === Number(value);
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  range.forEach((displayValue) => {
    const storedValue = Number(displayValue) / factor;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-sm btn-outline-secondary";
    button.textContent = String(displayValue);
    button.dataset.storedValue = String(storedValue);
    button.addEventListener("click", () => {
      setFieldInputValue(input, storedValue);
      updateButtons(storedValue);
    });
    buttons.push(button);
    wrapper.appendChild(button);
  });
  wrapper._setFieldValue = updateButtons;
  updateButtons(initialValue);
  return wrapper;
}

export function renderPercentageField(name, info, node, initialValue) {
  const input = document.createElement("input");
  input.type = "number";
  input.step = String(getFieldOptions(node).step ?? "any");
  input.className = "o_input";
  input.id = `field-${name}`;
  input.name = name;
  input.dataset.fieldWidget = "float_factor";
  input.dataset.factor = "100";
  if (info.required) input.required = true;
  if (initialValue !== undefined && initialValue !== false && initialValue !== null) {
    input.value = Number(initialValue) * 100;
  }
  input._setFieldValue = (value) => {
    input.value = value === false || value == null || value === "" ? "" : Number(value) * 100;
  };
  const wrapper = document.createElement("div");
  wrapper.className = "input-group";
  wrapper.append(input);
  const suffix = document.createElement("span");
  suffix.className = "input-group-text";
  suffix.textContent = "%";
  wrapper.appendChild(suffix);
  return wrapper;
}

/** Progressbar view; editing is enabled only when Odoo's option requests it. */
export function renderProgressBarField(name, info, node, initialValue, initialValues = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "o_field_progressbar";
  const options = getFieldOptions(node);
  const editable = options.editable === true;
  const current = options.current_value && initialValues[options.current_value] !== undefined
    ? Number(initialValues[options.current_value])
    : Number(initialValue) || 0;
  const maxOption = options.max_value;
  const max = typeof maxOption === "string" && Object.prototype.hasOwnProperty.call(initialValues, maxOption)
    ? Number(initialValues[maxOption])
    : Number(maxOption);
  const maximum = Number.isFinite(max) && max > 0 ? max : 100;
  const percent = Math.max(0, Math.min(100, (current / maximum) * 100));

  const input = editable
    ? document.createElement("input")
    : makeHiddenFieldInput(name, initialValue);
  if (editable) {
    input.type = "number";
    input.step = "any";
    input.className = "o_input";
    input.id = `field-${name}`;
    input.name = name;
    input.value = initialValue ?? "";
  }
  wrapper.appendChild(input);

  const barTrack = document.createElement("div");
  barTrack.className = "progress mt-1";
  barTrack.setAttribute("role", "progressbar");
  barTrack.setAttribute("aria-valuemin", "0");
  barTrack.setAttribute("aria-valuemax", String(maximum));
  barTrack.setAttribute("aria-valuenow", String(current));
  const bar = document.createElement("div");
  bar.className = "progress-bar";
  bar.style.width = `${percent}%`;
  barTrack.appendChild(bar);
  wrapper.appendChild(barTrack);

  const label = document.createElement("small");
  label.className = "text-muted";
  label.textContent = `${current} / ${maximum}`;
  wrapper.appendChild(label);

  function updateProgress(value) {
    const numericValue = Number(value) || 0;
    const ratio = Math.max(0, Math.min(100, (numericValue / maximum) * 100));
    bar.style.width = `${ratio}%`;
    barTrack.setAttribute("aria-valuenow", String(numericValue));
    label.textContent = `${numericValue} / ${maximum}`;
  }
  if (editable) input.addEventListener("input", () => updateProgress(input.value));
  wrapper._setFieldValue = (value) => {
    input.value = value === false || value == null ? "" : String(value);
    updateProgress(value);
  };
  return wrapper;
}

export function renderPercentPieField(name, info, node, initialValue) {
  const wrapper = document.createElement("div");
  wrapper.className = "o_field_percentpie d-flex align-items-center gap-2";
  const hiddenInput = makeHiddenFieldInput(name, initialValue);
  wrapper.appendChild(hiddenInput);
  const pie = document.createElement("span");
  pie.className = "o_percent_pie rounded-circle d-inline-flex align-items-center justify-content-center";
  pie.style.cssText = "width:42px;height:42px;border-radius:50%;";
  wrapper.appendChild(pie);

  function updatePie(rawValue) {
    hiddenInput.value = rawValue === false || rawValue == null ? "" : String(rawValue);
    const value = Math.max(0, Math.min(100, Number(rawValue) || 0));
    pie.style.background = `conic-gradient(#714b67 ${value}%, #e9ecef 0)`;
    pie.textContent = `${Math.round(value)}%`;
    pie.setAttribute("aria-label", `${Math.round(value)} pour cent`);
  }
  wrapper._setFieldValue = updatePie;
  updatePie(initialValue);
  return wrapper;
}

/** Readonly statistic value with an optional label field. */
export function renderStatInfoField(name, info, node, initialValue, initialValues = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "o_field_statinfo d-flex flex-column";
  const hiddenInput = makeHiddenFieldInput(name, initialValue);
  wrapper.appendChild(hiddenInput);

  const options = getFieldOptions(node);
  const valueDisplay = document.createElement("span");
  valueDisplay.className = "o_stat_value fw-bold";
  valueDisplay.textContent = initialValue === false || initialValue == null ? "0" : String(initialValue);
  wrapper.appendChild(valueDisplay);

  const labelText = options.label_field
    ? initialValues[options.label_field]
    : (node?.getAttribute("string") || info.label);
  if (labelText) {
    const label = document.createElement("span");
    label.className = "o_stat_text text-muted";
    label.textContent = String(labelText);
    wrapper.appendChild(label);
  }
  wrapper._setFieldValue = (newValue) => {
    hiddenInput.value = newValue === false || newValue == null ? "" : String(newValue);
    valueDisplay.textContent = newValue === false || newValue == null ? "0" : String(newValue);
  };
  return wrapper;
}
