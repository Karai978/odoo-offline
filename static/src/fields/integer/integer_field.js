/**
 * fields/integer/integer_field.js
 */

export function renderIntegerField(name, info, node, initialValue) {
  const input = document.createElement("input");
  input.type = "number";
  input.step = "1";
  input.className = "o_input";
  input.id = `field-${name}`;
  input.name = name;
  input.placeholder = node ? (node.getAttribute("placeholder") || "") : "";
  if (info.required) input.required = true;
  if (initialValue !== undefined && initialValue !== false) input.value = initialValue;
  return input;
}
