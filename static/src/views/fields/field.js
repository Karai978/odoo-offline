/**
 * Convert an XML <field> node into its Odoo type-specific or widget-specific
 * form control. Unknown widget names deliberately fall back to the field type.
 */
import { applyDynamicAttrs } from "../../model/relational_model/dynamic_field_attrs.js";

import {
  renderBadgeField,
  renderCharField,
  renderCharTextareaField,
  renderEmailField,
  renderLinkButtonField,
  renderPhoneField,
  renderUrlField,
} from "./char/char_field.js";
import { renderTextField } from "./text/text_field.js";
import { renderIntegerField } from "./integer/integer_field.js";
import {
  renderFloatField,
  renderFloatFactorField,
  renderFloatTimeField,
  renderFloatToggleField,
  renderPercentPieField,
  renderPercentageField,
  renderProgressBarField,
  renderStatInfoField,
} from "./float/float_field.js";
import {
  renderBooleanField,
  renderBooleanFavoriteField,
  renderBooleanToggleField,
} from "./boolean/boolean_field.js";
import {
  renderLabelSelectionField,
  renderPriorityField,
  renderRadioField,
  renderSelectionBadgeField,
  renderSelectionField,
} from "./selection/selection_field.js";
import { renderDateField, renderDateRangeField, renderRemainingDaysField } from "./date/date_field.js";
import { renderDatetimeField } from "./datetime/datetime_field.js";
import { renderMonetaryField } from "./monetary/monetary_field.js";
import {
  renderMany2oneAvatarField,
  renderMany2oneField,
  renderMany2oneRadioField,
} from "./many2one/many2one_field.js";
import {
  renderMany2manyCheckboxesField,
  renderMany2manyTagsField,
} from "./many2many_tags/many2many_tags_field.js";
import { renderOne2manyField } from "./x2many/x2many_field.js";

const TYPE_RENDERERS = {
  char: renderCharField,
  text: renderTextField,
  integer: renderIntegerField,
  float: renderFloatField,
  boolean: renderBooleanField,
  selection: renderSelectionField,
  date: renderDateField,
  datetime: renderDatetimeField,
  many2one: renderMany2oneField,
  one2many: renderOne2manyField,
  monetary: renderMonetaryField,
  many2many: renderMany2manyTagsField,
};

// Widget renderers are scoped to Odoo field types, so an unsupported or
// incompatible `widget` attribute cannot break the fallback type renderer.
const WIDGET_RENDERERS = {
  char: {
    email: renderEmailField,
    phone: renderPhoneField,
    url: renderUrlField,
    badge: renderBadgeField,
    link_button: renderLinkButtonField,
    text: renderCharTextareaField,
    textarea: renderCharTextareaField,
    domain: renderCharTextareaField,
    ace: renderCharTextareaField,
  },
  text: {
    badge: renderBadgeField,
  },
  integer: {
    progressbar: renderProgressBarField,
    percentpie: renderPercentPieField,
    statinfo: renderStatInfoField,
  },
  float: {
    float_time: renderFloatTimeField,
    float_factor: renderFloatFactorField,
    float_toggle: renderFloatToggleField,
    percentage: renderPercentageField,
    progressbar: renderProgressBarField,
    percentpie: renderPercentPieField,
    statinfo: renderStatInfoField,
  },
  monetary: {
    statinfo: renderStatInfoField,
  },
  boolean: {
    boolean_toggle: renderBooleanToggleField,
    boolean_favorite: renderBooleanFavoriteField,
  },
  selection: {
    radio: renderRadioField,
    priority: renderPriorityField,
    selection_badge: renderSelectionBadgeField,
    label_selection: renderLabelSelectionField,
    badge: renderBadgeField,
  },
  date: {
    daterange: renderDateRangeField,
    remaining_days: renderRemainingDaysField,
  },
  datetime: {
    daterange: renderDateRangeField,
    remaining_days: renderRemainingDaysField,
  },
  many2one: {
    radio: renderMany2oneRadioField,
    many2one_avatar: renderMany2oneAvatarField,
    many2one_avatar_user: renderMany2oneAvatarField,
    many2one_avatar_employee: renderMany2oneAvatarField,
    many2one_avatar_partner: renderMany2oneAvatarField,
    badge: renderBadgeField,
  },
  many2many: {
    many2many_checkboxes: renderMany2manyCheckboxesField,
  },
};

function getFieldRenderer(info, node) {
  const widget = node?.getAttribute("widget");
  const fieldType = info?.type;
  return (widget && WIDGET_RENDERERS[fieldType]?.[widget]) || TYPE_RENDERERS[fieldType] || null;
}

export function renderField(node, fieldsInfo, initialValues, securityContext, hasRecordId) {
  const fieldName = node.getAttribute("name");
  if (!fieldName) return null;

  const info = fieldsInfo[fieldName];
  if (!info) return null;

  const renderer = getFieldRenderer(info, node);
  if (!renderer) return null;

  const cell = document.createElement("div");
  cell.className = "o_row d-flex";
  cell.setAttribute("data-field-row", fieldName);
  if (info.type === "one2many") cell.setAttribute("data-one2many", fieldName);

  const nolabelAttr = node.getAttribute("nolabel");
  const skipLabel = nolabelAttr === "1" || info.type === "one2many";

  const valueWrapper = document.createElement("div");
  valueWrapper.className = `o_field_widget o_field_${info.type}`;

  const initialValue = initialValues ? initialValues[fieldName] : undefined;

  // Simulate the sequence placeholder locally for empty readonly fields on
  // creation; this keeps the form offline and avoids an empty edit control.
  const readonlyAttr = node.getAttribute("readonly");
  const isStaticReadonly = readonlyAttr === "1" || readonlyAttr === "true" || readonlyAttr === "True";
  const isEmptyValue =
    initialValue === undefined || initialValue === null ||
    initialValue === false || initialValue === "";
  const simulateNew = isStaticReadonly && !hasRecordId && isEmptyValue;

  let inputEl;
  if (simulateNew) {
    inputEl = document.createElement("span");
    inputEl.className = "o_form_readonly";
    inputEl.setAttribute("data-field", fieldName);
    inputEl.textContent = "Nouveau";
  } else {
    inputEl = renderer(fieldName, info, node, initialValue, initialValues);
  }

  applyDynamicAttrs(node, inputEl, initialValues);

  if (!skipLabel) {
    const label = document.createElement("label");
    label.className = "o_form_label";
    label.setAttribute("for", `field-${fieldName}`);
    label.textContent = info.label;
    cell.appendChild(label);
  }

  valueWrapper.appendChild(inputEl);
  applyDynamicAttrs(node, valueWrapper, initialValues);

  cell.appendChild(valueWrapper);
  return cell;
}

/** Used by x2many sublists to create a field control without a form row. */
export function createFieldInput(fieldName, info, initialValue, node = null, initialValues = {}) {
  const renderer = getFieldRenderer(info, node);
  if (!renderer) return null;
  return renderer(fieldName, info, node, initialValue, initialValues);
}
