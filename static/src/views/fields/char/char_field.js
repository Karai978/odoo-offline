/**
 * Char widgets. Odoo renders email/phone/URL values as editable inputs and
 * turns them into links in readonly mode.
 */
import { getReferenceRecords } from "../../../core/name_service.js";
import { getFieldOptions, getSelectionLabel, makeHiddenFieldInput } from "../field_utils.js";

export function renderCharField(name, info, node, initialValue) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "o_input";
  input.id = `field-${name}`;
  input.name = name;
  input.placeholder = node ? (node.getAttribute("placeholder") || "") : "";
  if (info.required) input.required = true;
  if (initialValue) input.value = initialValue;
  return input;
}

function isStaticallyReadonly(node) {
  const value = node?.getAttribute("readonly");
  return value === "1" || value === "True" || value === "true";
}

function renderCharInput(name, info, node, initialValue, type) {
  if (isStaticallyReadonly(node)) {
    const wrapper = document.createElement("div");
    wrapper.className = "o_field_char_readonly";
    wrapper.appendChild(makeHiddenFieldInput(name, initialValue));
    const value = initialValue || "";
    if (!value) return wrapper;

    const link = document.createElement("a");
    link.textContent = value;
    if (type === "email") link.href = `mailto:${value}`;
    else if (type === "tel") link.href = `tel:${value.replace(/[^+0-9*#;,]/g, "")}`;
    else link.href = normalizeUrl(value, node);
    if (type === "url") link.target = "_blank";
    link.rel = "noopener noreferrer";
    wrapper.appendChild(link);
    return wrapper;
  }

  const input = document.createElement("input");
  input.type = type;
  input.className = "o_input";
  input.id = `field-${name}`;
  input.name = name;
  input.placeholder = node?.getAttribute("placeholder") || "";
  if (info.required) input.required = true;
  if (initialValue !== undefined && initialValue !== false && initialValue !== null) {
    input.value = initialValue;
  }
  return input;
}

export function renderEmailField(name, info, node, initialValue) {
  return renderCharInput(name, info, node, initialValue, "email");
}

export function renderPhoneField(name, info, node, initialValue) {
  return renderCharInput(name, info, node, initialValue, "tel");
}

export function renderUrlField(name, info, node, initialValue) {
  return renderCharInput(name, info, node, initialValue, "url");
}

function normalizeUrl(value, node) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (getFieldOptions(node).website_path && trimmed.startsWith("/")) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/** The Odoo `badge` widget is a readonly pill; keep a hidden canonical value. */
export function renderBadgeField(name, info, node, initialValue) {
  const wrapper = document.createElement("div");
  wrapper.className = "o_field_badge";

  let label = info.type === "selection"
    ? getSelectionLabel(info, initialValue)
    : (Array.isArray(initialValue) ? initialValue[1] : (initialValue || ""));

  if (info.type === "many2one" && initialValue && !Array.isArray(initialValue)) {
    getReferenceRecords(info.relation).then((records) => {
      const record = records.find((item) => String(item.id) === String(initialValue));
      if (record) badge.textContent = record.display_name;
    }).catch((err) => console.warn(`Badge ${info.relation}:`, err));
  }

  if (info.type === "many2one") {
    const hidden = document.createElement("input");
    hidden.type = "hidden";
    hidden.name = `${name}_id`;
    hidden.value = Array.isArray(initialValue) ? initialValue[0] : (initialValue || "");
    wrapper.appendChild(hidden);
  } else {
    wrapper.appendChild(makeHiddenFieldInput(name, initialValue));
  }

  const badge = document.createElement("span");
  badge.className = "badge rounded-pill text-bg-secondary";
  badge.textContent = label;
  wrapper.appendChild(badge);
  return wrapper;
}

/** Link button is intentionally display-only, like Odoo's link_button widget. */
export function renderLinkButtonField(name, info, node, initialValue) {
  const wrapper = document.createElement("div");
  wrapper.className = "o_field_link_button";
  wrapper.appendChild(makeHiddenFieldInput(name, initialValue));
  if (!initialValue) return wrapper;

  const link = document.createElement("a");
  link.href = normalizeUrl(String(initialValue), node);
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.className = "d-inline-flex align-items-center gap-1";
  const icon = document.createElement("i");
  icon.className = "fa fa-external-link";
  icon.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  text.textContent = node?.getAttribute("text") || String(initialValue);
  link.append(icon, text);
  wrapper.appendChild(link);
  return wrapper;
}

/** A safe text editor fallback for Odoo's technical `domain` and `ace` widgets. */
export function renderCharTextareaField(name, info, node, initialValue) {
  const textarea = document.createElement("textarea");
  textarea.className = "o_input";
  textarea.id = `field-${name}`;
  textarea.name = name;
  textarea.rows = 4;
  textarea.spellcheck = false;
  textarea.placeholder = node?.getAttribute("placeholder") || "";
  if (info.required) textarea.required = true;
  if (initialValue !== undefined && initialValue !== false && initialValue !== null) {
    textarea.value = initialValue;
  }
  return textarea;
}
