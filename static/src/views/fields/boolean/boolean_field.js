/**
 * views/fields/boolean/boolean_field.js
 */

export function renderBooleanField(name, info, node, initialValue) {
  const wrapper = document.createElement("div");
  wrapper.className = "o-checkbox form-check";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "form-check-input";
  input.id = `field-${name}`;
  input.name = name;
  if (initialValue) input.checked = true;
  wrapper.appendChild(input);
  return wrapper;
}
