/**
 * views/fields/many2one/many2one_field.js
 */

import { queueAction } from "../../../core/network/rpc_service.js";
import { getReferenceRecords } from "../../../core/name_service.js";
import { getFieldOptions, setFieldInputValue } from "../field_utils.js";

async function createLocalRecord(relationModel, name) {
  const localUuid = await queueAction(relationModel, "create", { name }, "generic");
  return `tmp:${localUuid}`;
}

export function renderMany2oneField(name, info, node, initialValue) {
  const wrapper = document.createElement("div");
  wrapper.className = "o_field_many2one position-relative";

  // can_create is already calculated by get_view() on the Odoo server side
  // based on actual ORM permissions for the relation model — no recalculation
  // is needed here, unlike invisible/readonly, which depend on current
  // form values. no_create (in "options") is a view configuration choice,
  // independent of permissions.
  const options = getFieldOptions(node);
  const canCreateAttr = node ? node.getAttribute("can_create") : null;
  const allowQuickCreate =
    !options.no_create &&
    !options.no_quick_create &&
    options.quick_create !== false &&
    canCreateAttr !== "False";

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
      const initialId = Array.isArray(initialValue) ? initialValue[0] : initialValue;
      hiddenId.value = initialId;
      const found = cachedRecords.find((r) => String(r.id) === String(initialId));
      if (found) input.value = found.display_name;
      else if (Array.isArray(initialValue) && initialValue[1]) input.value = initialValue[1];
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
        // Sélection faite en JS, donc aucun événement natif ne se déclenche
        // tout seul — indispensable pour que attachLiveOnchange() (et
        // attachLiveBusinessRules()) détectent le changement.
        input.dispatchEvent(new Event("change", { bubbles: true }));
        closeDropdown();
      });
      li.appendChild(a);
      dropdown.appendChild(li);
    });

    // "Create '...'" option — offered only if permissions (can_create,
    // a true reflection of ORM permissions calculated by Odoo) and view
    // configuration (options.no_create) allow it, just like in real Odoo.
    if (allowQuickCreate) {
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
          input.dispatchEvent(new Event("change", { bubbles: true }));
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

/**
 * Odoo's `radio` widget also accepts many2one fields. This offline version
 * uses the already cached relation records (and therefore requires no RPC).
 */
export function renderMany2oneRadioField(name, info, node, initialValue) {
  const wrapper = document.createElement("div");
  wrapper.className = "o_field_many2one_radio d-flex flex-wrap gap-2";
  wrapper.setAttribute("role", "radiogroup");

  const initialId = Array.isArray(initialValue) ? initialValue[0] : initialValue;
  const hiddenId = document.createElement("input");
  hiddenId.type = "hidden";
  hiddenId.name = `${name}_id`;
  hiddenId.value = initialId || "";
  wrapper.appendChild(hiddenId);

  const choices = document.createElement("div");
  choices.className = getFieldOptions(node).horizontal ? "d-flex flex-wrap gap-3" : "d-flex flex-column gap-1";
  wrapper.appendChild(choices);

  function renderRecords(records) {
    choices.replaceChildren();
    const knownIds = new Set(records.map((record) => String(record.id)));
    if (initialId && !knownIds.has(String(initialId))) {
      records = [{
        id: initialId,
        display_name: Array.isArray(initialValue) ? initialValue[1] : `#${initialId}`,
      }, ...records];
    }

    records.slice(0, 100).forEach((record, index) => {
      const label = document.createElement("label");
      label.className = "form-check d-flex align-items-center gap-1 mb-0";

      const radio = document.createElement("input");
      radio.type = "radio";
      radio.className = "form-check-input mt-0";
      radio.name = `${name}__radio`;
      radio.value = record.id;
      if (info.required) radio.required = true;
      radio.checked = String(record.id) === String(hiddenId.value);
      radio.setAttribute("aria-label", record.display_name || `Option ${index + 1}`);
      radio.addEventListener("change", () => setFieldInputValue(hiddenId, radio.value));

      const text = document.createElement("span");
      text.textContent = record.display_name || `#${record.id}`;
      label.append(radio, text);
      choices.appendChild(label);
    });
  }

  getReferenceRecords(info.relation)
    .then(renderRecords)
    .catch((err) => console.warn(`Relation ${info.relation}:`, err));

  return wrapper;
}

/** Avatar-style many2one fallback: initials are rendered from the cached name. */
export function renderMany2oneAvatarField(name, info, node, initialValue) {
  const wrapper = renderMany2oneField(name, info, node, initialValue);
  wrapper.classList.add("o_field_many2one_avatar", "d-flex", "align-items-center", "gap-2");

  const avatar = document.createElement("span");
  avatar.className = "o_avatar rounded-circle d-inline-flex align-items-center justify-content-center flex-shrink-0";
  avatar.style.cssText = "width:28px;height:28px;background:#714b67;color:#fff;font-size:12px;";
  avatar.textContent = "?";
  wrapper.insertBefore(avatar, wrapper.firstChild);

  const visibleInput = wrapper.querySelector(`#field-${name}`);
  const hiddenId = wrapper.querySelector(`input[name="${name}_id"]`);
  let records = [];

  function initials(value) {
    return String(value || "").trim().split(/\s+/).filter(Boolean).slice(0, 2)
      .map((part) => part[0]).join("").toUpperCase() || "?";
  }

  function updateAvatar() {
    const selectedId = hiddenId?.value;
    const record = records.find((item) => String(item.id) === String(selectedId));
    avatar.textContent = initials(record?.display_name || visibleInput?.value);
  }

  visibleInput?.addEventListener("input", updateAvatar);
  visibleInput?.addEventListener("change", updateAvatar);
  getReferenceRecords(info.relation).then((cachedRecords) => {
    records = cachedRecords;
    updateAvatar();
  }).catch((err) => console.warn(`Avatar ${info.relation}:`, err));

  const initialLabel = Array.isArray(initialValue) ? initialValue[1] : "";
  if (initialLabel) avatar.textContent = initials(initialLabel);
  return wrapper;
}
