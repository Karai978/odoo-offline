/**
 * fields/datetime/datetime_field.js
 */

export function renderDatetimeField(name, info, node, initialValue) {
  const input = document.createElement("input");
  input.type = "datetime-local";
  input.className = "o_input";
  input.id = `field-${name}`;
  input.name = name;
  input.placeholder = node ? (node.getAttribute("placeholder") || "") : "";
  if (info.required) input.required = true;
  if (initialValue) input.value = initialValue;
  return input;
}
