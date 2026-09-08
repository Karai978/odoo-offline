/**
 * fields/x2many/x2many_field.js
 */

import { evaluateSimpleCondition } from "../../core/py_js/py_utils.js";
import { attachComputeEngine } from "../../views/relational_model/compute_engine.js";
import { getApiKey, CONFIG } from "../../core/browser/session.js";
import { getCatalogProductsSmart } from "../../core/orm/catalog_cache.js";
import { db } from "../../core/orm/orm_service.js";
import {
  detectCatalogFieldNames,
  getExistingQuantitiesFromTbody,
  renderProductCatalog,
} from "../product_catalog/product_catalog.js";
import { createFieldInput } from "../field.js";

let one2manyRowCounter = 0;

/**
 * Generic retrieval of labels for the one2many "add" bar
 * from <control><create string="..."/></control> in the XML architecture —
 * never hard-coded text for a specific model. If the architecture
 * does not define these elements, it falls back to generic, neutral labels.
 */
function getControlLabels(treeNode) {
  const labels = {
    default: "Ajouter une ligne",
    section: null,
    note: null,
    catalog: null,
  };

  if (!treeNode) return labels;

  const controlNode = Array.from(treeNode.children).find((c) => c.tagName === "control");
  if (!controlNode) return labels;

  Array.from(controlNode.children).forEach((child) => {
    if (child.tagName === "create") {
      const str = child.getAttribute("string");
      const context = child.getAttribute("context") || "";
      if (!str) return;
      if (context.includes("line_section")) {
        labels.section = str;
      } else if (context.includes("line_note")) {
        labels.note = str;
      } else {
        labels.default = str;
      }
    } else if (child.tagName === "button") {
      labels.catalog = {
        string: child.getAttribute("string") || "",
        name: child.getAttribute("name") || "",
      };
    }
  });

  return labels;
}

export function renderOne2manyField(name, info, node, initialValue, parentValues) {
  const wrapper = document.createElement("div");
  wrapper.className = "o_field_one2many";
  wrapper.dataset.o2mRoot = "true";

  const rendererDiv = document.createElement("div");
  rendererDiv.className = "o_list_renderer table-responsive";
  wrapper.appendChild(rendererDiv);

  const subFields = info.sub_fields || {};
  let columns = [];

  let controlLabels = { default: "Ajouter une ligne", section: null, note: null, catalog: null };

  if (node) {
    const treeNode = Array.from(node.children).find((c) => c.tagName === "tree" || c.tagName === "list");
    if (treeNode) {
      controlLabels = getControlLabels(treeNode);
      for (const fieldNode of Array.from(treeNode.children).filter((c) => c.tagName === "field")) {
        const fname = fieldNode.getAttribute("name");
        if (!fname || !subFields[fname]) continue;

        const widget = fieldNode.getAttribute("widget");
        if (widget === "handle") continue;

        const columnInvisible = fieldNode.getAttribute("column_invisible");
        const invisible = fieldNode.getAttribute("invisible");
        const optional = fieldNode.getAttribute("optional"); // "show" | "hide" | null

        if (columnInvisible === "1" || columnInvisible === "True") continue;
        if (columnInvisible && evaluateSimpleCondition(columnInvisible, {}, parentValues) === true) continue;

        if (invisible === "1" || invisible === "True") continue;
        if (invisible && evaluateSimpleCondition(invisible, {}, parentValues) === true) continue;

        // We no longer "continue" with optional="hide": the column is retained,
        // simply hidden by default and toggleable via the gear icon.
        columns.push({
          field: fname,
          label: fieldNode.getAttribute("string") || subFields[fname].label,
          optional: optional || null,
          visible: optional !== "hide",
        });
      }
    }
  }

  if (columns.length === 0) {
    const priorityFields = ["product_template_id", "product_id", "name", "product_uom_qty", "price_unit", "product_uom"];
    columns = priorityFields
      .filter((f) => subFields[f])
      .map((f) => ({ field: f, label: subFields[f].label }));

    if (columns.length === 0) {
      columns = Object.keys(subFields).slice(0, 4).map((f) => ({ field: f, label: subFields[f].label }));
    }
  }

  const table = document.createElement("table");
  table.className = "o_list_table table table-sm";

  function colClass(field) {
    return `o2m-col-${name}-${field}`;
  }

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");

  columns.forEach((col) => {
    const th = document.createElement("th");
    th.textContent = col.label;
    th.className = colClass(col.field);
    if (!col.visible) th.classList.add("d-none");
    headRow.appendChild(th);
  });

  // Latest task: existing delete button + gear icon, implemented
  // ONLY if the schema contains at least one "optional" column.
  const actionsHeaderTh = document.createElement("th");
  actionsHeaderTh.className = "o_list_controller o_list_actions_header position-sticky end-0";
  actionsHeaderTh.style.position = "relative";

  const optionalColumns = columns.filter((c) => c.optional === "show" || c.optional === "hide");

  if (optionalColumns.length > 0) {
    const dropdownWrap = document.createElement("div");
    dropdownWrap.className = "o-dropdown dropdown o_optional_columns_dropdown text-center border-top-0 o-dropdown--no-caret";
    dropdownWrap.style.position = "relative";

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "dropdown-toggle btn p-0";
    toggleBtn.tabIndex = -1;
    toggleBtn.setAttribute("aria-expanded", "false");
    toggleBtn.innerHTML = '<i class="o_optional_columns_dropdown_toggle oi oi-fw oi-settings-adjust"></i>';

    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.className = "o_optional_columns_dropdown o-dropdown--menu dropdown-menu";
    menu.style.cssText = "position:absolute; top:100%; right:0; display:none; z-index:1000;";

    optionalColumns.forEach((col, idx) => {
      const item = document.createElement("span");
      item.className = "dropdown-item";
      item.setAttribute("role", "menuitem");
      item.tabIndex = 0;

      const checkboxWrap = document.createElement("div");
      checkboxWrap.className = "o-checkbox form-check";

      const checkboxId = `pwa-optcol-${name}-${col.field}-${idx}`;
      const input = document.createElement("input");
      input.type = "checkbox";
      input.className = "form-check-input";
      input.id = checkboxId;
      input.name = col.field;
      input.checked = col.visible;

      const label = document.createElement("label");
      label.className = "form-check-label";
      label.setAttribute("for", checkboxId);
      label.innerHTML = `<span class="d-flex align-items-center"><span class="text-truncate">${col.label}</span></span>`;

      input.addEventListener("change", () => {
        col.visible = input.checked;
        rendererDiv.querySelectorAll(`.${colClass(col.field)}`).forEach((el) => {
          el.classList.toggle("d-none", !col.visible);
        });
      });

      checkboxWrap.appendChild(input);
      checkboxWrap.appendChild(label);
      item.appendChild(checkboxWrap);
      menu.appendChild(item);
    });

    toggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.style.display = menu.style.display === "none" ? "block" : "none";
    });
    document.addEventListener("click", (e) => {
      if (!dropdownWrap.contains(e.target)) menu.style.display = "none";
    });

    dropdownWrap.appendChild(toggleBtn);
    dropdownWrap.appendChild(menu);
    actionsHeaderTh.appendChild(dropdownWrap);
  }

  headRow.appendChild(actionsHeaderTh);
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  table.appendChild(tbody);
  rendererDiv.appendChild(table);

  const addRowTr = document.createElement("tr");
  const addRowSpacerTd = document.createElement("td");
  addRowTr.appendChild(addRowSpacerTd);

  const addRowTd = document.createElement("td");
  addRowTd.className = "o_field_x2many_list_row_add";
  addRowTd.colSpan = columns.length + 1;

  const addBtn = document.createElement("a");
  addBtn.href = "#";
  addBtn.textContent = controlLabels.default;
  addBtn.addEventListener("click", (e) => {
    e.preventDefault();
    addRow();
    recomputeTotal();
  });
  addRowTd.appendChild(addBtn);

  function addSectionOrNoteRow(placeholder) {
    const tr = document.createElement("tr");
    tr.className = "o_data_row";
    const td = document.createElement("td");
    td.colSpan = columns.length + 1;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "o_input border-0 w-100 fw-bold";
    input.placeholder = placeholder;
    td.appendChild(input);
    tr.appendChild(td);
    tbody.insertBefore(tr, addRowTr);
  }

  if (controlLabels.section) {
    const addSectionBtn = document.createElement("a");
    addSectionBtn.href = "#";
    addSectionBtn.className = "ml16";
    addSectionBtn.textContent = controlLabels.section;
    addSectionBtn.addEventListener("click", (e) => {
      e.preventDefault();
      addSectionOrNoteRow(controlLabels.section);
    });
    addRowTd.appendChild(addSectionBtn);
  }

  if (controlLabels.note) {
    const addNoteBtn = document.createElement("a");
    addNoteBtn.href = "#";
    addNoteBtn.className = "ml16";
    addNoteBtn.textContent = controlLabels.note;
    addNoteBtn.addEventListener("click", (e) => {
      e.preventDefault();
      addSectionOrNoteRow(controlLabels.note);
    });
    addRowTd.appendChild(addNoteBtn);
  }

  if (controlLabels.catalog) {
    const catalogBtn = document.createElement("button");
    catalogBtn.type = "button";
    catalogBtn.className = "btn px-4 btn-link ml16";
    catalogBtn.textContent = controlLabels.catalog.string || "Catalogue";
    catalogBtn.addEventListener("click", async () => {
      await openProductCatalog();
    });
    addRowTd.appendChild(catalogBtn);
  }

  /**
   * Opens the catalog overlay in place of the one2many table, reusing
   * addRow() (already a closure here)—no new navigation (SPA: the
   * current form is never lost).
   */
  async function openProductCatalog() {
    const { productFields, qtyField } = detectCatalogFieldNames(subFields);
    if (productFields.length === 0 || !qtyField || !productFields.includes("product_id")) {
      alert("Catalogue indisponible : champs produit/quantité non détectés pour ce modèle.");
      return;
    }

    const partnerId = getCurrentPartnerIdFromForm();

    if (!partnerId) {
      alert("Veuillez sélectionner un client (ou fournisseur) avant d'ouvrir le catalogue.");
      return;
    }

    // Model of the PARENT form (sale.order / purchase.order), read via
    // the data-model attribute set by form_controller.js — not subFields,
    // which describes the LINES, not the parent document.
    const catalogModel = wrapper.closest("[data-model]")?.dataset.model;
    if (!catalogModel) {
      alert("Impossible de déterminer le modèle du document courant.");
      return;
    }

    const apiKey = getApiKey();
    const products = await getCatalogProductsSmart(catalogModel, partnerId, apiKey, CONFIG.ODOO_BASE_URL);

    if (!products || products.length === 0) {
      alert("Aucun produit disponible dans le catalogue (hors-ligne sans cache, ou catalogue vide).");
      return;
    }

    const existingQuantities = getExistingQuantitiesFromTbody(tbody, qtyField);

    const overlay = renderProductCatalog(
      products,
      existingQuantities,
      async (finalQuantities) => {
        await applyCatalogSelection(finalQuantities, existingQuantities, productFields, qtyField, products);
        wrapper.replaceChild(rendererDiv, overlay);
        recomputeTotal();
      },
      "Retour"
    );

    wrapper.replaceChild(overlay, rendererDiv);
  }

  /**
   * Reads the CURRENT value of the Customer/Supplier field (partner_id) from
   * the current form, directly from the DOM—not from parentValues,
   * which is a snapshot frozen at the initial rendering of the one2many.
   * Scoped to the current form via closest(".o_form_view") rather than a
   * global document query (more robust in an SPA, where only one form is
   * mounted at a time, though this is no longer 100% guaranteed as it is
   * with a dedicated HTML page).
   */
  function getCurrentPartnerIdFromForm() {
    const formRoot = wrapper.closest(".o_form_view") || document;
    const hiddenInput = formRoot.querySelector('input[name="partner_id_id"]');
    if (!hiddenInput) return null;
    const raw = hiddenInput.value || "";
    if (!raw || raw.startsWith("tmp:")) return null; // création locale non synchronisée, pas utilisable comme filtre
    const id = parseInt(raw, 10);
    return isNaN(id) ? null : id;
  }

  /**
   * Reflects the quantities selected in the catalog in the actual
   * one2many table: adds a row for each product now having a
   * quantity > 0 that is not yet in the table, updates the quantity
   * for existing rows, and removes rows where the quantity is set to 0.
   */
  async function applyCatalogSelection(finalQuantities, previousQuantities, productFields, qtyField, products) {
    const productsById = {};
    products.forEach((p) => (productsById[p.id] = p));

    const referencesToCache = [];
    const pendingNewRows = [];

    Object.entries(finalQuantities).forEach(([productIdStr, qty]) => {
      const productId = parseInt(productIdStr, 10);
      const previousQty = previousQuantities[productId] || 0;
      if (qty === previousQty) return;

      const existingTr = Array.from(tbody.querySelectorAll("tr.o_data_row")).find((tr) => {
        const wrapperEl = tr._cellRefs?.["product_id"]?.el;
        const hiddenInput = wrapperEl?.querySelector('input[type="hidden"]');
        const rawId = hiddenInput?.value || "";
        if (!rawId || rawId.startsWith("tmp:")) return false;
        return parseInt(rawId, 10) === productId;
      });

      if (qty === 0 && existingTr) {
        existingTr.remove();
        return;
      }

      const product = productsById[productId];

      if (existingTr) {
        const qtyEl = existingTr._cellRefs[qtyField].el;
        qtyEl.value = qty;
        qtyEl.dispatchEvent(new Event("change", { bubbles: true }));

        const priceEl = existingTr._cellRefs["price_unit"]?.el;
        const subtotalEl = existingTr._cellRefs["price_subtotal"]?.el;
        if (priceEl && subtotalEl) {
          const price = parseFloat(priceEl.value) || 0;
          subtotalEl.value = (price * qty).toFixed(2);
        }
        const totalEl = existingTr._cellRefs["price_total"]?.el;
        if (totalEl && subtotalEl) {
          totalEl.value = subtotalEl.value;
        }
        return;
      }

      if (product) {
        if (productFields.includes("product_id")) {
          referencesToCache.push({
            model: subFields["product_id"]?.relation || "product.product",
            id: productId,
            display_name: product.name,
          });
        }
        if (productFields.includes("product_template_id") && product.product_tmpl_id) {
          referencesToCache.push({
            model: subFields["product_template_id"]?.relation || "product.template",
            id: product.product_tmpl_id,
            display_name: product.name,
          });
        }
      }

      pendingNewRows.push({ productId, qty, product });
    });

    if (referencesToCache.length > 0) {
      await db.reference_records.bulkPut(referencesToCache);
    }

    pendingNewRows.forEach(({ productId, qty, product }) => {
      const price = product ? Number(product.price) || 0 : 0;
      const subtotal = (price * qty).toFixed(2);

      const rowData = { [qtyField]: qty };

      if (productFields.includes("product_id")) {
        rowData["product_id"] = productId;
      }
      if (productFields.includes("product_template_id") && product && product.product_tmpl_id) {
        rowData["product_template_id"] = product.product_tmpl_id;
      }

      if (subFields["name"] && product) {
        rowData["name"] = product.name;
      }
      if (subFields["price_unit"]) {
        rowData["price_unit"] = price;
      }
      if (subFields["price_subtotal"]) {
        rowData["price_subtotal"] = subtotal;
      }
      if (subFields["price_total"]) {
        rowData["price_total"] = subtotal;
      }

      addRow(rowData);
    });
  }

  addRowTr.appendChild(addRowTd);
  tbody.appendChild(addRowTr);

  function addRow(rowData = {}) {
    const tr = document.createElement("tr");
    tr.className = "o_data_row";
    const cellRefs = {};

    columns.forEach((col) => {
      const td = document.createElement("td");
      td.className = colClass(col.field);
      if (!col.visible) td.classList.add("d-none");
      const finfo = subFields[col.field];
      const uniqueName = `${name}__${col.field}__${one2manyRowCounter}`;
      const inputEl = createFieldInput(uniqueName, finfo, rowData[col.field]);
      cellRefs[col.field] = { el: inputEl, info: finfo };
      td.appendChild(inputEl);
      tr.appendChild(td);
    });

    one2manyRowCounter++;

    const actionTd = document.createElement("td");
    actionTd.className = "o_list_record_remove text-center";
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "fa fa-trash-o";
    removeBtn.setAttribute("aria-label", "Supprimer la ligne");
    removeBtn.addEventListener("click", () => {
      tr.remove();
      recomputeTotal();
    });
    actionTd.appendChild(removeBtn);
    tr.appendChild(actionTd);

    tr._recordId = rowData.id || null;
    tr._cellRefs = cellRefs;
    tbody.insertBefore(tr, addRowTr);
  }

  const totalRow = document.createElement("div");
  totalRow.className = "text-end fw-bold mt-2 pe-3";
  totalRow.style.fontSize = "1.1em";
  wrapper.appendChild(totalRow);

  if (Array.isArray(initialValue)) {
    initialValue.forEach((rowData) => addRow(rowData));
  }

  wrapper._initialLineIds = new Set(
    Array.isArray(initialValue)
      ? initialValue.filter((r) => r && r.id).map((r) => r.id)
      : []
  );

  const recomputeTotal = attachComputeEngine(tbody, totalRow, parentValues);
  wrapper._getTbody = () => tbody;
  wrapper._isOne2many = true;

  return wrapper;
}
