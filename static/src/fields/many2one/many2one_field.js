/**
 * fields/many2one/many2one_field.js
 */

import { queueAction } from "../../core/network/rpc_service.js";
import { getReferenceRecords } from "../../core/name_service.js";

async function createLocalRecord(relationModel, name) {
  const localUuid = await queueAction(relationModel, "create", { name }, "generic");
  return `tmp:${localUuid}`;
}

/**
 * Minimal parser for the "options" attribute of Odoo views — syntax similar
 * to a Python dict (single quotes, capitalized True/False). Handles
 * common cases found in actual view architectures (no_create, no_open,
 * currency_field, etc.) — not a full Python parser.
 */
function parseOdooOptions(str) {
  if (!str) return {};
  try {
    const jsonLike = str
      .replace(/'/g, '"')
      .replace(/\bTrue\b/g, "true")
      .replace(/\bFalse\b/g, "false");
    return JSON.parse(jsonLike);
  } catch (err) {
    console.warn("Attribut options non parsé:", str, err);
    return {};
  }
}

export function renderMany2oneField(name, info, node, initialValue) {
  const wrapper = document.createElement("div");
  wrapper.className = "o_field_many2one position-relative";

  // can_create is already calculated by get_view() on the Odoo server side
  // based on actual ORM permissions for the relation model — no recalculation
  // is needed here, unlike invisible/readonly, which depend on current
  // form values. no_create (in "options") is a view configuration choice,
  // independent of permissions.
  const options = node ? parseOdooOptions(node.getAttribute("options")) : {};
  const canCreateAttr = node ? node.getAttribute("can_create") : null;
  const allowCreate = !options.no_create && canCreateAttr !== "False";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "o_input";
  input.id = `field-${name}`;
  input.name = name;

  // Raw placeholder as defined in the Odoo XML arch (no translation
  // available offline) — empty if the arch does not specify one, like Odoo.
  input.placeholder = node ? (node.getAttribute("placeholder") || "") : "";
  input.autocomplete = "off";
  if (info.required) input.required = true;

  const hiddenId = document.createElement("input");
  hiddenId.type = "hidden";
  hiddenId.name = `${name}_id`;

  const dropdown = document.createElement("ul");
  dropdown.className = "dropdown-menu show";
  dropdown.style.display = "none";
  dropdown.style.position = "absolute";
  dropdown.style.width = "100%";

  wrapper.appendChild(input);
  wrapper.appendChild(hiddenId);
  wrapper.appendChild(dropdown);

  let cachedRecords = [];
  getReferenceRecords(info.relation).then((records) => {
    cachedRecords = records;
    if (initialValue) {
      hiddenId.value = initialValue;
      const found = cachedRecords.find((r) => r.id === initialValue);
      if (found) input.value = found.display_name;
    }
  }).catch((err) => console.warn(`Relation ${info.relation}:`, err));

  function closeDropdown() {
    dropdown.style.display = "none";
    dropdown.innerHTML = "";
  }

  input.addEventListener("input", () => {
    const query = input.value;
    const queryLower = query.toLowerCase();
    dropdown.innerHTML = "";
    hiddenId.value = "";

    if (!query) {
      closeDropdown();
      return;
    }

    const matches = cachedRecords.filter((r) => r.display_name.toLowerCase().includes(queryLower)).slice(0, 20);

    matches.forEach((record) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.className = "dropdown-item";
      a.href = "#";
      a.textContent = record.display_name;
      a.addEventListener("click", (e) => {
        e.preventDefault();
        input.value = record.display_name;
        hiddenId.value = record.id;
        closeDropdown();
      });
      li.appendChild(a);
      dropdown.appendChild(li);
    });

    // "Create '...'" option — offered only if permissions (can_create,
    // a true reflection of ORM permissions calculated by Odoo) and view
    // configuration (options.no_create) allow it, just like in real Odoo.
    if (allowCreate) {
      const createLi = document.createElement("li");
      const createA = document.createElement("a");
      createA.className = "dropdown-item fst-italic text-primary";
      createA.href = "#";
      createA.textContent = `Créer "${query}"`;
      createA.addEventListener("click", async (e) => {
        e.preventDefault();
        createA.textContent = "Création en cours...";
        try {
          const tmpRef = await createLocalRecord(info.relation, query);
          cachedRecords.push({ id: tmpRef, display_name: query });
          input.value = query;
          hiddenId.value = tmpRef;
        } catch (err) {
          console.error("Création locale impossible:", err);
          alert("Impossible de créer cet enregistrement localement.");
        }
        closeDropdown();
      });
      createLi.appendChild(createA);
      dropdown.appendChild(createLi);
    }

    dropdown.style.display = "block";
  });

  document.addEventListener("click", (e) => {
    if (!wrapper.contains(e.target)) closeDropdown();
  });

  return wrapper;
}
