/**
 * Boolean widgets used by Odoo 17 form architectures.
 */
function renderCheckbox(name, initialValue, extraClass = "") {
  const wrapper = document.createElement("div");
  wrapper.className = `o-checkbox form-check ${extraClass}`.trim();

  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "form-check-input";
  input.id = `field-${name}`;
  input.name = name;
  input.checked = !!initialValue;
  wrapper.appendChild(input);
  return { wrapper, input };
}

export function renderBooleanField(name, info, node, initialValue) {
  return renderCheckbox(name, initialValue).wrapper;
}

/** Odoo's `boolean_toggle` presentation, while preserving checkbox semantics. */
export function renderBooleanToggleField(name, info, node, initialValue) {
  return renderCheckbox(name, initialValue, "form-switch o_boolean_toggle").wrapper;
}

/** Odoo's star-style `boolean_favorite` widget. */
export function renderBooleanFavoriteField(name, info, node, initialValue) {
  const wrapper = document.createElement("div");
  wrapper.className = "o_field_boolean_favorite";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.id = `field-${name}`;
  input.name = name;
  input.checked = !!initialValue;
  input.tabIndex = -1;
  input.style.cssText = "position:absolute;width:1px;height:1px;opacity:0;";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-link p-0";
  button.setAttribute("aria-label", "Favori");

  function renderState() {
    const icon = document.createElement("i");
    icon.className = input.checked ? "fa fa-star text-warning" : "fa fa-star-o text-muted";
    icon.setAttribute("aria-hidden", "true");
    button.replaceChildren(icon);
    button.setAttribute("aria-pressed", input.checked ? "true" : "false");
  }
  renderState();
  wrapper._setFieldValue = (value) => {
    input.checked = !!value;
    renderState();
  };

  button.addEventListener("click", () => {
    input.checked = !input.checked;
    renderState();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  wrapper.append(input, button);
  return wrapper;
}
