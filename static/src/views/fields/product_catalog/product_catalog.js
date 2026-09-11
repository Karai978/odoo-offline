/**
 * views/fields/product_catalog/product_catalog.js
 */

const CATALOG_PRODUCT_FIELD_CANDIDATES = ["product_id", "product_template_id"];
const CATALOG_QTY_FIELD_CANDIDATES = ["product_uom_qty", "product_qty", "quantity"];

/**
 * Detects ALL "product" fields present on this line model—not just one.
 * Depending on whether product variants are enabled in Odoo, product_id
 * may be visible OR hidden in favor of product_template_id. We therefore
 * populate BOTH fields if they exist, each with the correct ID—ensuring
 * correctness regardless of the mode.
 */
export function detectCatalogFieldNames(subFields) {
  const productFields = CATALOG_PRODUCT_FIELD_CANDIDATES.filter((f) => subFields[f]);
  const qtyField = CATALOG_QTY_FIELD_CANDIDATES.find((f) => subFields[f]) || null;
  return { productFields, qtyField };
}

/**
 * The product_id field (even if hidden/d-none) always remains present in the
 * DOM with the actual product.product value—so it is ALWAYS the one
 * used as the reference to locate an existing row, regardless of which
 * field is visually displayed.
 */
export function getExistingQuantitiesFromTbody(tbody, qtyField) {
  const map = {};
  if (!qtyField) return map;

  Array.from(tbody.querySelectorAll("tr.o_data_row")).forEach((tr) => {
    const cellRefs = tr._cellRefs;
    if (!cellRefs || !cellRefs["product_id"] || !cellRefs[qtyField]) return;

    const productWrapper = cellRefs["product_id"].el;
    const hiddenInput = productWrapper?.querySelector('input[type="hidden"]');
    const qtyEl = cellRefs[qtyField].el;

    const rawId = hiddenInput?.value || "";
    if (!rawId || rawId.startsWith("tmp:")) return;

    const productId = parseInt(rawId, 10);
    const qty = qtyEl?.value ? parseFloat(qtyEl.value) : 0;

    if (!isNaN(productId)) {
      map[productId] = (map[productId] || 0) + qty;
    }
  });

  return map;
}

function formatCatalogPrice(price) {
  if (price === null || price === undefined) return "";
  return `$ ${Number(price).toFixed(2)}`;
}

/**
 * Renders a product card with a +/- stepper.
 * `quantities` is a shared object `{ [productId]: qty }` that is mutated directly
 * by the buttons—avoiding a full grid re-render on every click.
 */
function renderCatalogCard(product, quantities, onQtyChange) {
  const card = document.createElement("div");
  card.className = "o_product_catalog_card border rounded p-2 d-flex flex-column";
  card.style.cssText = "min-width: 260px; max-width: 260px;";

  const header = document.createElement("div");
  header.className = "d-flex align-items-start mb-2";

  if (product.image_base64) {
    const img = document.createElement("img");
    img.src = product.image_base64;
    img.alt = product.name;
    img.style.cssText = "width:48px; height:48px; object-fit:contain; margin-right:8px;";
    header.appendChild(img);
  }

  const titleWrap = document.createElement("div");
  const title = document.createElement("div");
  title.className = "fw-bold";
  title.textContent = product.name;
  titleWrap.appendChild(title);

  if (product.default_code) {
    const code = document.createElement("div");
    code.className = "text-muted small";
    code.textContent = `[${product.default_code}]`;
    titleWrap.appendChild(code);
  }
  header.appendChild(titleWrap);
  card.appendChild(header);

  const priceLine = document.createElement("div");
  priceLine.className = "small";
  priceLine.textContent = `Prix unitaire : ${formatCatalogPrice(product.price)}`;
  card.appendChild(priceLine);

  const availLine = document.createElement("div");
  availLine.className = "small text-muted";
  availLine.textContent = `Disponible : ${Number(product.qty_available ?? 0).toFixed(2)}`;
  card.appendChild(availLine);

  if (product.min_qty) {
    const minLine = document.createElement("div");
    minLine.className = "small text-muted";
    minLine.textContent = `Quantité minimum : ${product.min_qty}`;
    card.appendChild(minLine);
  }

  const stepperWrap = document.createElement("div");
  stepperWrap.className = "mt-2";
  card.appendChild(stepperWrap);

  function renderStepper() {
    stepperWrap.innerHTML = "";
    const qty = quantities[product.id] || 0;

    if (qty === 0) {
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "btn btn-secondary btn-sm w-100";
      addBtn.innerHTML = '<i class="fa fa-shopping-cart"></i> Ajouter';
      addBtn.addEventListener("click", () => {
        quantities[product.id] = 1;
        onQtyChange(product.id, 1);
        renderStepper();
      });
      stepperWrap.appendChild(addBtn);
      return;
    }

    const group = document.createElement("div");
    group.className = "input-group input-group-sm";

    const minusBtn = document.createElement("button");
    minusBtn.type = "button";
    minusBtn.className = "btn btn-primary";
    minusBtn.innerHTML = '<i class="fa fa-minus"></i>';
    minusBtn.addEventListener("click", () => {
      const newQty = Math.max(0, (quantities[product.id] || 0) - 1);
      quantities[product.id] = newQty;
      onQtyChange(product.id, newQty);
      renderStepper();
    });

    const input = document.createElement("input");
    input.type = "number";
    input.className = "form-control text-center";
    input.value = qty;
    input.min = "0";
    input.addEventListener("change", () => {
      const newQty = Math.max(0, parseFloat(input.value) || 0);
      quantities[product.id] = newQty;
      onQtyChange(product.id, newQty);
      renderStepper();
    });

    const plusBtn = document.createElement("button");
    plusBtn.type = "button";
    plusBtn.className = "btn btn-primary";
    plusBtn.innerHTML = '<i class="fa fa-plus"></i>';
    plusBtn.addEventListener("click", () => {
      const newQty = (quantities[product.id] || 0) + 1;
      quantities[product.id] = newQty;
      onQtyChange(product.id, newQty);
      renderStepper();
    });

    group.appendChild(minusBtn);
    group.appendChild(input);
    group.appendChild(plusBtn);
    stepperWrap.appendChild(group);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn btn-light border btn-sm w-100 mt-1";
    removeBtn.innerHTML = '<i class="fa fa-trash"></i> Supprimer';
    removeBtn.addEventListener("click", () => {
      quantities[product.id] = 0;
      onQtyChange(product.id, 0);
      renderStepper();
    });
    stepperWrap.appendChild(removeBtn);
  }

  renderStepper();
  return card;
}

/**
 * Widget entry point. Returns a DOM element ready to be inserted
 * in place of the form — see usage in x2many_field.js.
 *
 * @param {Array} products - result of getCatalogProductsSmart()
 * @param {Object} existingQuantities - { [productId]: qty } pre-filled values
 * @param {Function} onBack - called with the final map { [productId]: qty }
 *                            when clicking "Back"
 * @param {string} backLabel - "Back to quote" / "Back to order"
 */
export function renderProductCatalog(products, existingQuantities, onBack, backLabel) {
  const quantities = { ...existingQuantities };

  const wrapper = document.createElement("div");
  wrapper.className = "o_product_catalog_overlay";

  const toolbar = document.createElement("div");
  toolbar.className = "d-flex align-items-center justify-content-between mb-3 px-2 pt-2";

  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "btn btn-link p-0";
  backBtn.textContent = `← ${backLabel || "Retour"}`;
  backBtn.addEventListener("click", () => {
    onBack(quantities);
  });
  toolbar.appendChild(backBtn);

  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.className = "o_input form-control form-control-sm";
  searchInput.style.maxWidth = "260px";
  searchInput.placeholder = "Rechercher...";
  toolbar.appendChild(searchInput);

  wrapper.appendChild(toolbar);

  const grid = document.createElement("div");
  grid.className = "d-flex flex-wrap gap-3 p-3";
  wrapper.appendChild(grid);

  function renderGrid(filterText) {
    grid.innerHTML = "";
    const q = (filterText || "").trim().toLowerCase();
    const filtered = q
      ? products.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            (p.default_code && p.default_code.toLowerCase().includes(q))
        )
      : products;

    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "text-muted p-4";
      empty.textContent = "Aucun produit trouvé.";
      grid.appendChild(empty);
      return;
    }

    filtered.forEach((product) => {
      grid.appendChild(renderCatalogCard(product, quantities, () => {}));
    });
  }

  searchInput.addEventListener("input", () => renderGrid(searchInput.value));
  renderGrid("");

  return wrapper;
}
