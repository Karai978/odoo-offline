/**
 * fields/text/text_field.js
 */

export function renderTextField(name, info, node, initialValue) {
  const textarea = document.createElement("textarea");
  textarea.className = "o_input";
  textarea.id = `field-${name}`;
  textarea.name = name;
  textarea.placeholder = node ? (node.getAttribute("placeholder") || "") : "";
  if (info.required) textarea.required = true;
  if (initialValue) textarea.value = initialValue;
  return textarea;
}
