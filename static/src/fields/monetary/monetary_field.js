/**
 * fields/monetary/monetary_field.js
 */

export function renderMonetaryField(name, info, node, initialValue) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "o_input";
  input.id = `field-${name}`;
  input.name = name;
  input.readOnly = true;
  input.value = initialValue ? Number(initialValue).toFixed(2) : "0.00";
  return input;
}
