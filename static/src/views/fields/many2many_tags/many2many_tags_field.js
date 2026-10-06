/**
 * views/fields/many2many_tags/many2many_tags_field.js
 */

import { getReferenceRecords } from "../../../core/name_service.js";

export function renderMany2manyTagsField(name, info, node, initialValue) {
  const wrapper = document.createElement("div");
  wrapper.className = "o_field_many2many_tags position-relative";
  wrapper.style.cssText = "display:flex; gap:4px; flex-wrap:wrap; align-items:center; padding:4px 0;";

  // Internal state: list of currently selected [id, display_name] pairs.
  let selected = Array.isArray(initialValue)
    ? initialValue.map((v) => (Array.isArray(v) ? v : [v, String(v)]))
    : [];

  const tagsContainer = document.createElement("div");
  tagsContainer.style.cssText = "display:flex; gap:4px; flex-wrap:wrap;";
  wrapper.appendChild(tagsContainer);

  const inputWrap = document.createElement("div");
  inputWrap.style.cssText = "position:relative; min-width:80px; flex-grow:1;";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "o_input border-0";
  input.style.cssText = "min-width:80px; width:100%;";
  input.placeholder = "Rechercher...";
  input.autocomplete = "off";
  inputWrap.appendChild(input);

  const dropdown = document.createElement("ul");
  dropdown.className = "dropdown-menu show";
  dropdown.style.cssText = "display:none; position:absolute; top:100%; left:0; min-width:180px; z-index:1000;";
  inputWrap.appendChild(dropdown);

  wrapper.appendChild(inputWrap);

  let cachedRecords = [];
  getReferenceRecords(info.relation).then((records) => {
    cachedRecords = records;
  }).catch((err) => console.warn(`Relation ${info.relation}:`, err));

  // Synchronized hidden field so that FormData() captures the value.
  const hiddenInput = document.createElement("input");
  hiddenInput.type = "hidden";
  hiddenInput.name = name;
  wrapper.appendChild(hiddenInput);

  function syncHiddenValue(notifyChange = false) {
    hiddenInput.value = JSON.stringify(selected.map(([id]) => id));
    if (notifyChange) {
      hiddenInput.dispatchEvent(new Event("input", { bubbles: true }));
      hiddenInput.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function renderTags() {
    tagsContainer.innerHTML = "";
    selected.forEach(([id, label]) => {
      const tag = document.createElement("span");
      tag.className = "badge rounded-pill text-bg-secondary d-flex align-items-center gap-1";
      const text = document.createElement("span");
      text.textContent = label;
      tag.appendChild(text);

      const removeBtn = document.createElement("a");
      removeBtn.href = "#";
      removeBtn.className = "text-white";
      removeBtn.innerHTML = "&times;";
      removeBtn.addEventListener("click", (e) => {
        e.preventDefault();
        selected = selected.filter(([sid]) => sid !== id);
        renderTags();
        syncHiddenValue(true);
      });
      tag.appendChild(removeBtn);

      tagsContainer.appendChild(tag);
    });
  }

  wrapper._setFieldValue = (value) => {
    selected = (Array.isArray(value) ? value : []).map((item) => {
      const id = Array.isArray(item) ? item[0] : (item && typeof item === "object" ? item.id : item);
      const cached = cachedRecords.find((record) => String(record.id) === String(id));
      const label = Array.isArray(item) ? item[1] : (item && typeof item === "object" ? item.display_name : cached?.display_name);
      return [id, label || String(id ?? "")];
    }).filter(([id]) => id !== undefined && id !== null && id !== false);
    renderTags();
    syncHiddenValue();
  };

  function closeDropdown() {
    dropdown.style.display = "none";
    dropdown.innerHTML = "";
  }

  input.addEventListener("input", () => {
    const query = input.value.toLowerCase();
    dropdown.innerHTML = "";

    if (!query) {
      closeDropdown();
      return;
    }

    const selectedIds = new Set(selected.map(([sid]) => sid));
    const matches = cachedRecords
      .filter((r) => !selectedIds.has(r.id) && r.display_name.toLowerCase().includes(query))
      .slice(0, 20);

    matches.forEach((record) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.className = "dropdown-item";
      a.href = "#";
      a.textContent = record.display_name;
      a.addEventListener("click", (e) => {
        e.preventDefault();
        selected.push([record.id, record.display_name]);
        renderTags();
        syncHiddenValue(true);
        input.value = "";
        closeDropdown();
      });
      li.appendChild(a);
      dropdown.appendChild(li);
    });

    dropdown.style.display = matches.length > 0 ? "block" : "none";
  });

  document.addEventListener("click", (e) => {
    if (!wrapper.contains(e.target)) closeDropdown();
  });

  renderTags();
  syncHiddenValue();

  return wrapper;
}
/** Odoo's `many2many_checkboxes` widget, backed by the existing relation cache. */
export function renderMany2manyCheckboxesField(name, info, node, initialValue) {
  const wrapper = document.createElement("div");
  wrapper.className = "o_field_many2many_checkboxes d-flex flex-column gap-1";

  const selected = new Map();
  (Array.isArray(initialValue) ? initialValue : []).forEach((item) => {
    const id = Array.isArray(item) ? item[0] : (item && typeof item === "object" ? item.id : item);
    const label = Array.isArray(item) ? item[1] : (item && typeof item === "object" ? item.display_name : String(item ?? ""));
    if (id !== undefined && id !== null && id !== false) selected.set(String(id), label || String(id));
  });

  const hiddenInput = document.createElement("input");
  hiddenInput.type = "hidden";
  hiddenInput.id = `field-${name}`;
  hiddenInput.name = name;
  wrapper.appendChild(hiddenInput);

  function syncSelection(notifyChange = false) {
    const ids = Array.from(selected.keys()).map((id) => /^\d+$/.test(id) ? Number(id) : id);
    hiddenInput.value = JSON.stringify(ids);
    if (notifyChange) {
      hiddenInput.dispatchEvent(new Event("input", { bubbles: true }));
      hiddenInput.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function renderRecords(records) {
    wrapper.querySelectorAll("label").forEach((label) => label.remove());
    const knownIds = new Set(records.map((record) => String(record.id)));
    const missingSelected = Array.from(selected, ([id, display_name]) => ({ id, display_name }))
      .filter((record) => !knownIds.has(String(record.id)));
    [...records, ...missingSelected].slice(0, 200).forEach((record, index) => {
      const id = String(record.id);
      const label = document.createElement("label");
      label.className = "form-check d-flex align-items-center gap-2 mb-0";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "form-check-input mt-0";
      checkbox.id = `field-${name}-option-${index}`;
      checkbox.value = id;
      checkbox.checked = selected.has(id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selected.set(id, record.display_name || id);
        else selected.delete(id);
        syncSelection(true);
      });

      const text = document.createElement("span");
      text.textContent = record.display_name || id;
      label.append(checkbox, text);
      wrapper.appendChild(label);
    });
    syncSelection();
  }

  wrapper._setFieldValue = (value) => {
    selected.clear();
    (Array.isArray(value) ? value : []).forEach((item) => {
      const id = Array.isArray(item) ? item[0] : (item && typeof item === "object" ? item.id : item);
      const label = Array.isArray(item) ? item[1] : (item && typeof item === "object" ? item.display_name : String(item ?? ""));
      if (id !== undefined && id !== null && id !== false) selected.set(String(id), label || String(id));
    });
    wrapper.querySelectorAll("input[type=checkbox]").forEach((checkbox) => {
      checkbox.checked = selected.has(String(checkbox.value));
    });
    syncSelection();
  };

  syncSelection();
  getReferenceRecords(info.relation).then(renderRecords).catch((err) => {
    console.warn(`Relation ${info.relation}:`, err);
  });
  return wrapper;
}
