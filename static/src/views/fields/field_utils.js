/**
 * Shared helpers for native form-field widgets.
 * Odoo serializes `options` with Python-literal syntax rather than strict JSON.
 */
export function parseOdooOptions(rawOptions) {
  if (!rawOptions || typeof rawOptions !== "string") return {};
  try {
    const jsonLike = pythonLiteralToJson(rawOptions);
    const parsed = JSON.parse(jsonLike);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    console.warn("Options de champ Odoo non analysées :", rawOptions, err);
    return {};
  }
}

/** Convert the safe JSON-compatible subset of Python literals used in Odoo options. */
function pythonLiteralToJson(source) {
  let output = "";
  let index = 0;

  while (index < source.length) {
    const char = source[index];

    if (char === "'" || char === '"') {
      const quote = char;
      let value = "";
      index++;
      let closed = false;
      while (index < source.length) {
        const current = source[index++];
        if (current === quote) {
          closed = true;
          break;
        }
        if (current !== "\\") {
          value += current;
          continue;
        }
        if (index >= source.length) {
          value += "\\";
          break;
        }

        const escaped = source[index++];
        const escapes = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" };
        if (Object.prototype.hasOwnProperty.call(escapes, escaped)) {
          value += escapes[escaped];
        } else if (escaped === quote || escaped === "\\") {
          value += escaped;
        } else {
          // Retain unknown Python escapes literally (for example, a regex).
          value += `\\${escaped}`;
        }
      }
      if (!closed) throw new SyntaxError("Unterminated string in Odoo options");
      output += JSON.stringify(value);
      continue;
    }

    if (char === "(") {
      output += "[";
      index++;
      continue;
    }
    if (char === ")") {
      output += "]";
      index++;
      continue;
    }
    if (char === "," && /^[\s]*[}\]]/.test(source.slice(index + 1))) {
      index++;
      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      const start = index;
      while (index < source.length && /[A-Za-z0-9_]/.test(source[index])) index++;
      const token = source.slice(start, index);
      const nextNonSpace = source.slice(index).match(/^\s*(.)/)?.[1];
      if (token === "True") output += "true";
      else if (token === "False") output += "false";
      else if (token === "None") output += "null";
      else if (nextNonSpace === ":") output += JSON.stringify(token);
      else output += token;
      continue;
    }

    output += char;
    index++;
  }

  // Trailing commas were skipped while scanning, outside quoted strings.
  return output;
}

export function getFieldOptions(node) {
  return parseOdooOptions(node?.getAttribute("options"));
}

/**
 * Hidden value control used by button/radio-style widgets. Keeping the
 * canonical value in an input with the standard field ID means the existing
 * form serializer and dynamic readonly rules can continue to work.
 */
export function makeHiddenFieldInput(name, value = "") {
  const input = document.createElement("input");
  input.type = "hidden";
  input.id = `field-${name}`;
  input.name = name;
  input.value = value === false || value === null || value === undefined ? "" : String(value);
  return input;
}

export function setFieldInputValue(input, value) {
  input.value = value === false || value === null || value === undefined ? "" : String(value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

export function getSelectionLabel(info, value) {
  const found = (info?.selection || []).find(([candidate]) => String(candidate) === String(value));
  return found ? found[1] : (value === false || value == null ? "" : String(value));
}

export function createSelectionValueInput(name, info, initialValue) {
  const select = document.createElement("select");
  select.className = "o_input";
  select.id = `field-${name}`;
  select.name = name;
  select.hidden = true;
  select.required = !!info.required;

  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = "";
  select.appendChild(emptyOption);

  (info.selection || []).forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  });
  if (initialValue !== undefined && initialValue !== false && initialValue !== null) {
    select.value = String(initialValue);
  }
  return select;
}
