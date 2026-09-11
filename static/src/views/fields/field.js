/**
 * views/fields/field.js
 * converts an XML architecture node (<field name="..."/>) into an HTML component 
 * incorporating labels, the graphical component associated with the data type, 
 * and dynamic attributes (readonly, required)
*/

import { applyDynamicAttrs } from "../../model/relational_model/dynamic_field_attrs.js";

import { renderCharField } from "./char/char_field.js";
import { renderTextField } from "./text/text_field.js";
import { renderIntegerField } from "./integer/integer_field.js";
import { renderFloatField } from "./float/float_field.js";
import { renderBooleanField } from "./boolean/boolean_field.js";
import { renderSelectionField } from "./selection/selection_field.js";
import { renderDateField } from "./date/date_field.js";
import { renderDatetimeField } from "./datetime/datetime_field.js";
import { renderMonetaryField } from "./monetary/monetary_field.js";
import { renderMany2oneField } from "./many2one/many2one_field.js";
import { renderMany2manyTagsField } from "./many2many_tags/many2many_tags_field.js";
import { renderOne2manyField } from "./x2many/x2many_field.js";

const SUPPORTED_FIELD_WIDGETS = {
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

export function renderField(node, fieldsInfo, initialValues, securityContext, hasRecordId) {
  const fieldName = node.getAttribute("name");
  if (!fieldName) return null;

  const info = fieldsInfo[fieldName];
  if (!info) return null;

  const renderer = SUPPORTED_FIELD_WIDGETS[info.type];
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

  // "New" simulation (100% offline): a read-only field (e.g., sequence
  // name) that is empty in creation mode never displays an empty input in
  // Odoo, but rather the text "New"—without a network call.
  const readonlyAttr = node.getAttribute("readonly");
  const isStaticReadonly = readonlyAttr === "1" || readonlyAttr === "true";
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

/** Used by fields/x2many/x2many_field.js to create a row input cell. */
export function createFieldInput(fieldName, info, initialValue) {
  const renderer = SUPPORTED_FIELD_WIDGETS[info.type];
  if (!renderer) return null;
  return renderer(fieldName, info, null, initialValue);
}
