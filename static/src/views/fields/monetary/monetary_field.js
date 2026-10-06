/** Editable Odoo monetary input with cached currency symbol presentation. */
import { getReferenceRecords } from "../../../core/name_service.js";
import { getFieldOptions } from "../field_utils.js";

export function renderMonetaryField(name, info, node, initialValue, initialValues = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "input-group o_field_monetary";

  const options = getFieldOptions(node);
  const currencyField = info.currency_field || options.currency_field;
  const currencyValue = currencyField ? initialValues[currencyField] : null;
  const currencyId = Array.isArray(currencyValue) ? currencyValue[0] : currencyValue;
  const prefix = document.createElement("span");
  prefix.className = "input-group-text d-none";
  const suffix = document.createElement("span");
  suffix.className = "input-group-text d-none";

  const input = document.createElement("input");
  input.type = "number";
  input.step = "any";
  input.className = "o_input";
  input.id = `field-${name}`;
  input.name = name;
  input.placeholder = node?.getAttribute("placeholder") || "";
  if (info.required) input.required = true;
  if (initialValue !== undefined && initialValue !== false && initialValue !== null && initialValue !== "") {
    input.value = Number(initialValue);
  }

  wrapper.append(prefix, input, suffix);
  if (currencyId) {
    getReferenceRecords("res.currency").then((currencies) => {
      const currency = currencies.find((item) => String(item.id) === String(currencyId));
      if (!currency?.symbol) return;
      const symbol = String(currency.symbol);
      if (currency.position === "before") {
        prefix.textContent = symbol;
        prefix.classList.remove("d-none");
      } else {
        suffix.textContent = symbol;
        suffix.classList.remove("d-none");
      }
    }).catch((err) => console.warn("Devise non résolue pour le champ monétaire:", err));
  }
  return wrapper;
}
