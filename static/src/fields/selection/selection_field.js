/**
 * fields/selection/selection_field.js
 */

export function renderSelectionField(name, info, node, initialValue) {
  const select = document.createElement("select");
  select.className = "o_input";
  select.id = `field-${name}`;
  select.name = name;
  if (info.required) select.required = true;

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
