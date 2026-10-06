/**
 * Selection widgets supported by the Odoo 17 form renderer.
 */
import {
  createSelectionValueInput,
  getFieldOptions,
  getSelectionLabel,
  setFieldInputValue,
} from "../field_utils.js";

export function renderSelectionField(name, info, node, initialValue) {
  const select = document.createElement("select");
  select.className = "o_input";
  select.id = `field-${name}`;
  select.name = name;
  if (info.required) select.required = true;
  select.placeholder = node?.getAttribute("placeholder") || "";

  const emptyOpt = document.createElement("option");
  emptyOpt.value = "";
  emptyOpt.textContent = "";
  select.appendChild(emptyOpt);

  (info.selection || []).forEach(([value, label]) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    if (initialValue !== undefined && String(initialValue) === String(value)) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });

  return select;
}

/** Odoo's `radio` widget for selection fields. */
export function renderRadioField(name, info, node, initialValue) {
  const wrapper = document.createElement("div");
  wrapper.className = "o_field_radio";
  wrapper.setAttribute("role", "radiogroup");
  const options = getFieldOptions(node);
  const choices = document.createElement("div");
  choices.className = options.horizontal ? "d-flex flex-wrap gap-3" : "d-flex flex-column gap-1";
  const valueInput = createSelectionValueInput(name, info, initialValue);
  wrapper.appendChild(valueInput);
  const radios = [];

  (info.selection || []).forEach(([value, labelText], index) => {
    const label = document.createElement("label");
    label.className = "form-check d-flex align-items-center gap-1 mb-0";

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.className = "form-check-input mt-0";
    radio.name = `${name}__radio`;
    radio.value = value;
    if (info.required) radio.required = true;
    radio.checked = initialValue !== undefined && String(initialValue) === String(value);
    radio.setAttribute("aria-label", labelText || `Option ${index + 1}`);
    radio.addEventListener("change", () => setFieldInputValue(valueInput, radio.value));

    const text = document.createElement("span");
    text.textContent = labelText;
    label.append(radio, text);
    choices.appendChild(label);
    radios.push(radio);
  });
  wrapper.appendChild(choices);
  wrapper._setFieldValue = (value) => {
    valueInput.value = value === false || value == null ? "" : String(value);
    radios.forEach((radio) => {
      radio.checked = String(radio.value) === String(value ?? "");
    });
  };
  return wrapper;
}

/** Odoo's `selection_badge` widget; badges remain editable in form mode. */
export function renderSelectionBadgeField(name, info, node, initialValue) {
  const wrapper = document.createElement("div");
  wrapper.className = "o_field_selection_badge d-flex flex-wrap gap-1";
  const valueInput = createSelectionValueInput(name, info, initialValue);
  wrapper.appendChild(valueInput);

  const buttons = [];
  const updateButtons = (value) => {
    buttons.forEach((entry) => {
      const active = String(entry.dataset.value) === String(value ?? "");
      entry.classList.toggle("active", active);
      entry.setAttribute("aria-pressed", String(active));
    });
  };
  (info.selection || []).forEach(([value, labelText]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-sm btn-outline-secondary";
    button.textContent = labelText;
    button.setAttribute("aria-pressed", String(initialValue !== undefined && String(initialValue) === String(value)));
    button.addEventListener("click", () => {
      setFieldInputValue(valueInput, value);
      updateButtons(value);
    });
    button.dataset.value = value;
    button.classList.toggle("active", initialValue !== undefined && String(initialValue) === String(value));
    buttons.push(button);
    wrapper.appendChild(button);
  });
  wrapper._setFieldValue = (value) => {
    valueInput.value = value === false || value == null ? "" : String(value);
    updateButtons(value);
  };
  return wrapper;
}

/** Odoo's `priority` stars for selection values (commonly 0, 1, 2, 3). */
export function renderPriorityField(name, info, node, initialValue) {
  const wrapper = document.createElement("div");
  wrapper.className = "o_field_priority d-flex align-items-center gap-1";
  wrapper.setAttribute("role", "radiogroup");
  const valueInput = createSelectionValueInput(name, info, initialValue);
  wrapper.appendChild(valueInput);

  const choices = info.selection || [];
  const zeroIndex = choices.findIndex(([value]) => String(value) === "0");
  const firstStarIndex = zeroIndex >= 0 ? zeroIndex + 1 : 0;
  const starCount = Math.max(1, choices.length - firstStarIndex);
  const stars = [];

  function updateStars(level) {
    stars.forEach((button, index) => {
      const active = index < level;
      button.querySelector("i").className = active ? "fa fa-star text-warning" : "fa fa-star-o text-muted";
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function setValue(value) {
    valueInput.value = value === false || value == null ? "" : String(value);
    const selectedIndex = choices.findIndex(([candidate]) => String(candidate) === String(value));
    const level = selectedIndex < 0 ? 0 : Math.max(0, selectedIndex - (zeroIndex >= 0 ? zeroIndex : -1));
    updateStars(level);
  }

  for (let index = 0; index < starCount; index++) {
    const optionIndex = firstStarIndex + index;
    const option = choices[optionIndex];
    if (!option) continue;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-link p-0";
    button.title = option[1] || `Priorité ${index + 1}`;
    button.setAttribute("aria-label", button.title);
    const icon = document.createElement("i");
    button.appendChild(icon);
    button.addEventListener("click", () => {
      const chosenIndex = choices.findIndex(([value]) => String(value) === String(option[0]));
      const currentIndex = choices.findIndex(([value]) => String(value) === String(valueInput.value));
      const resetTo = zeroIndex >= 0 ? choices[zeroIndex][0] : "";
      const nextValue = currentIndex === chosenIndex ? resetTo : option[0];
      setFieldInputValue(valueInput, nextValue);
      setValue(nextValue);
    });
    stars.push(button);
    wrapper.appendChild(button);
  }
  wrapper._setFieldValue = setValue;
  setValue(initialValue);
  return wrapper;
}

/** `label_selection` is readonly but its value is still included in saves. */
export function renderLabelSelectionField(name, info, node, initialValue) {
  const wrapper = document.createElement("div");
  wrapper.className = "o_field_label_selection";
  const valueInput = createSelectionValueInput(name, info, initialValue);
  wrapper.appendChild(valueInput);

  const label = document.createElement("span");
  const options = getFieldOptions(node);
  function setValue(value) {
    valueInput.value = value === false || value == null ? "" : String(value);
    const mappedClass = options.classes?.[String(value)];
    label.className = `badge rounded-pill ${mappedClass ? `text-bg-${mappedClass}` : "text-bg-secondary"}`;
    label.textContent = getSelectionLabel(info, value);
  }
  wrapper.appendChild(label);
  wrapper._setFieldValue = setValue;
  setValue(initialValue);
  return wrapper;
}
