/**
 * views/fields/date/date_field.js
 */

export function renderDateField(name, info, node, initialValue) {
  const input = document.createElement("input");
  input.type = "date"; // native: calendar + yyyy-mm-dd format guaranteed by the browser
  input.className = "o_input";
  input.id = `field-${name}`;
  input.name = name;
  input.placeholder = node ? (node.getAttribute("placeholder") || "") : "";
  if (info.required) input.required = true;
  if (initialValue) input.value = initialValue; // already in ISO format, no conversion necessary
  return input;
}

/**
 * Converts an ISO date (yyyy-mm-dd, Odoo format) to the French
 * dd/mm/yyyy display format.
 */
export function isoToDisplayDate(isoValue) {
  if (!isoValue) return "";
  const [year, month, day] = isoValue.split("-");
  if (!year || !month || !day) return "";
  return `${day}/${month}/${year}`;
}

/**
 * Converts a date displayed in dd/mm/yyyy format to the ISO format (yyyy-mm-dd)
 * expected by Odoo.
 */
export function displayDateToIso(displayValue) {
  if (!displayValue) return false;
  const [day, month, year] = displayValue.split("/");
  if (!day || !month || !year) return false;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}
