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

  function syncHiddenValue() {
    hiddenInput.value = JSON.stringify(selected.map(([id]) => id));
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
        syncHiddenValue();
      });
      tag.appendChild(removeBtn);

      tagsContainer.appendChild(tag);
    });
  }

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
        syncHiddenValue();
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