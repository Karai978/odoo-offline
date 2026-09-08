/**
 * views/list/list_renderer.js
 * View rendering
 * List: optional column selector (⚙️), status badges, sorting
 * by column. Functionally unchanged from the original.
 */

import { renderListCell } from "./list_renderer_utils.js";
import { loadOptionalColumnsState, saveOptionalColumnsState } from "./list_column_prefs.js";

export function renderListView(archXml, fieldsInfo, records, onRowClick, modelName = null) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(archXml, "text/xml");
  const treeRoot = doc.querySelector("tree, list");

  let allColumns = [];
  if (treeRoot) {
    for (const fieldNode of Array.from(treeRoot.children).filter((c) => c.tagName === "field")) {
      const fname = fieldNode.getAttribute("name");
      if (!fname || !fieldsInfo[fname]) continue;

      const widget = fieldNode.getAttribute("widget");
      if (widget === "handle") continue;

      const columnInvisible = fieldNode.getAttribute("column_invisible");
      if (columnInvisible === "1" || columnInvisible === "True") continue;

      const optional = fieldNode.getAttribute("optional"); // "show" | "hide" | null
      allColumns.push({ field: fname, node: fieldNode, optional });
    }
  }
  if (allColumns.length === 0) {
    allColumns = Object.keys(fieldsInfo).slice(0, 6).map((f) => ({ field: f, node: null, optional: null }));
  }

  const optionalFieldsList = allColumns.filter((c) => c.optional === "show" || c.optional === "hide");
  const optionalState = loadOptionalColumnsState(
    modelName,
    optionalFieldsList.map((c) => ({ field: c.field, defaultVisible: c.optional === "show" }))
  );

  function getVisibleColumns() {
    return allColumns.filter((c) => {
      if (c.optional === "show" || c.optional === "hide") {
        return !!optionalState[c.field];
      }
      return true;
    });
  }

  let columns = getVisibleColumns();

  let currentRecords = records ? [...records] : [];
  let sortColumn = null;
  let sortAsc = true;
  const selectedIds = new Set();

  const wrapper = document.createElement("div");
  wrapper.className = "o_list_view o_view_controller";

  const rendererDiv = document.createElement("div");
  rendererDiv.className = "o_list_renderer table-responsive";
  wrapper.appendChild(rendererDiv);

  const table = document.createElement("table");
  table.className = "o_list_table table table-sm table-hover position-relative mb-0 o_list_table_ungrouped table-striped";
  table.style.tableLayout = "fixed";
  rendererDiv.appendChild(table);

  const thead = document.createElement("thead");
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  table.appendChild(tbody);

  let optionalDropdownEl = null;
  const closeDropdownOnOutsideClick = () => {
    if (optionalDropdownEl) optionalDropdownEl.classList.remove("show");
  };
  document.addEventListener("click", closeDropdownOnOutsideClick);

  function buildHeader() {
    columns = getVisibleColumns();
    thead.innerHTML = "";
    const headRow = document.createElement("tr");

    const selTh = document.createElement("th");
    selTh.className = "o_list_record_selector align-middle pe-1";
    selTh.style.width = "41px";
    const selWrap = document.createElement("div");
    selWrap.className = "o-checkbox form-check d-flex m-0";
    const selAll = document.createElement("input");
    selAll.type = "checkbox";
    selAll.className = "form-check-input";
    selAll.addEventListener("change", () => {
      selectedIds.clear();
      if (selAll.checked) currentRecords.forEach((r) => selectedIds.add(r.id));
      buildBody();
    });
    selWrap.appendChild(selAll);
    selTh.appendChild(selWrap);
    headRow.appendChild(selTh);

    columns.forEach((col) => {
      const th = document.createElement("th");
      th.dataset.name = col.field;
      th.className = "align-middle o_column_sortable position-relative cursor-pointer";
      const inner = document.createElement("div");
      inner.className = "d-flex";
      const label = document.createElement("span");
      label.className = "d-block min-w-0 text-truncate flex-grow-1";
      label.textContent = (col.node && col.node.getAttribute("string")) || fieldsInfo[col.field]?.label || col.field;
      inner.appendChild(label);
      const icon = document.createElement("i");
      icon.className = sortColumn === col.field
        ? `fa fa-lg fa-angle-${sortAsc ? "down" : "up"}`
        : "fa fa-lg fa-angle-down opacity-0";
      inner.appendChild(icon);
      th.appendChild(inner);

      th.addEventListener("click", () => {
        if (sortColumn === col.field) {
          sortAsc = !sortAsc;
        } else {
          sortColumn = col.field;
          sortAsc = true;
        }
        currentRecords.sort((a, b) => {
          const va = a[col.field], vb = b[col.field];
          const sa = Array.isArray(va) ? va[1] : va;
          const sb = Array.isArray(vb) ? vb[1] : vb;
          if (sa === sb) return 0;
          if (sa === false || sa === undefined) return 1;
          if (sb === false || sb === undefined) return -1;
          return (sa > sb ? 1 : -1) * (sortAsc ? 1 : -1);
        });
        buildHeader();
        buildBody();
      });

      headRow.appendChild(th);
    });

    const gearTh = document.createElement("th");
    gearTh.className = "o_list_actions_header position-relative";
    gearTh.style.width = "32px";

    if (optionalFieldsList.length > 0) {
      const gearBtn = document.createElement("button");
      gearBtn.type = "button";
      gearBtn.className = "btn btn-sm p-0 o_optional_columns_dropdown_toggle";
      gearBtn.title = "Options d'affichage";
      gearBtn.innerHTML = '<i class="fa fa-sliders"></i>';
      gearTh.appendChild(gearBtn);

      const dropdown = document.createElement("div");
      dropdown.className = "dropdown-menu o_optional_columns_dropdown p-2";
      dropdown.style.position = "absolute";
      dropdown.style.top = "100%";
      dropdown.style.right = "0";
      dropdown.style.zIndex = "1000";
      dropdown.style.minWidth = "220px";

      optionalFieldsList.forEach((col) => {
        const item = document.createElement("div");
        item.className = "dropdown-item py-1";
        const label = document.createElement("label");
        label.className = "d-flex align-items-center gap-2 mb-0 w-100";
        label.style.cursor = "pointer";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "form-check-input m-0";
        checkbox.checked = !!optionalState[col.field];
        checkbox.addEventListener("click", (e) => e.stopPropagation());
        checkbox.addEventListener("change", () => {
          optionalState[col.field] = checkbox.checked;
          saveOptionalColumnsState(modelName, optionalState);
          buildHeader();
          buildBody();
        });
        const text = document.createElement("span");
        text.textContent = (col.node && col.node.getAttribute("string")) || fieldsInfo[col.field]?.label || col.field;
        label.appendChild(checkbox);
        label.appendChild(text);
        item.appendChild(label);
        dropdown.appendChild(item);
      });

      gearTh.appendChild(dropdown);
      optionalDropdownEl = dropdown;

      gearBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        dropdown.classList.toggle("show");
      });
      dropdown.addEventListener("click", (e) => e.stopPropagation());
    }

    headRow.appendChild(gearTh);
    thead.appendChild(headRow);
  }

  function buildBody() {
    tbody.innerHTML = "";

    if (!currentRecords || currentRecords.length === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = columns.length + 2;
      td.className = "text-center text-muted p-4";
      td.textContent = "Aucun enregistrement.";
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    currentRecords.forEach((record) => {
      const tr = document.createElement("tr");
      tr.className = "o_data_row cursor-pointer";

      const selTd = document.createElement("td");
      selTd.className = "o_list_record_selector user-select-none";
      const selWrap = document.createElement("div");
      selWrap.className = "o-checkbox form-check";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "form-check-input";
      checkbox.checked = selectedIds.has(record.id);
      checkbox.addEventListener("click", (e) => e.stopPropagation());
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selectedIds.add(record.id);
        else selectedIds.delete(record.id);
      });
      selWrap.appendChild(checkbox);
      selTd.appendChild(selWrap);
      tr.appendChild(selTd);

      columns.forEach((col) => {
        const td = document.createElement("td");
        td.className = "o_data_cell o_field_cell";
        td.appendChild(renderListCell(record, col, fieldsInfo[col.field]));
        tr.appendChild(td);
      });

      const gearTd = document.createElement("td");
      tr.appendChild(gearTd);

      tr.addEventListener("click", () => onRowClick(record.id));
      tbody.appendChild(tr);
    });
  }

  buildHeader();
  buildBody();

  // Cleanup: the global listener on the document must be removed when
  // this view is unmounted; otherwise, it accumulates with each navigation
  // (a memory leak absent from the old multi-page version, where the entire
  // page—and thus the listener—disappeared upon a URL change).
  wrapper._cleanup = () => document.removeEventListener("click", closeDropdownOnOutsideClick);

  return wrapper;
}
