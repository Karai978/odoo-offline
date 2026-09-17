/**
 * model/relational_model/compute_engine.js
 * Real-time recalculation of the
 * total of a One2many field (e.g., order lines), resolving
 * the parent document's currency.
 */

import { getReferenceRecords } from "../../core/name_service.js";
import { runLineRules } from "../rules_engine/rules_engine.js";

const QTY_FIELD_CANDIDATES = ["product_uom_qty", "product_qty", "quantity", "qty"];
const PRICE_FIELD_CANDIDATES = ["price_unit"];

function findFirstAvailableField(cellRefs, candidates) {
  for (const name of candidates) {
    if (cellRefs[name]) return name;
  }
  return null;
}

function computeTotalFromRows(tbody) {
  let total = 0;
  Array.from(tbody.querySelectorAll("tr")).forEach((tr) => {
    if (!tr._cellRefs) return;

    // price_total (ou à défaut price_subtotal) est déjà calculé par la
    // règle _compute_amount de rules_engine (voir x2many_field.js ->
    // runLineRules) -- on le réutilise au lieu de refaire qty*price ici,
    // ce qui dupliquait la même règle métier avec le risque de diverger
    // (ex: si des taxes sont ajoutées un jour à la règle mais pas ici).
    if (tr._cellRefs["price_total"]) {
      total += parseFloat(tr._cellRefs["price_total"].el.value) || 0;
      return;
    }
    if (tr._cellRefs["price_subtotal"]) {
      total += parseFloat(tr._cellRefs["price_subtotal"].el.value) || 0;
      return;
    }

    // Fallback pour les one2many sans champs price_subtotal/price_total
    // (modèle non couvert par une règle spécifique de rules_engine) --
    // qty*price est désormais une règle générique (model: "*") dans
    // rules/generic_rules.js plutôt que réimplémenté ici (voir
    // computeLineSubtotal() historique).
    const qtyField = findFirstAvailableField(tr._cellRefs, QTY_FIELD_CANDIDATES);
    const priceField = findFirstAvailableField(tr._cellRefs, PRICE_FIELD_CANDIDATES);

    const qty = qtyField ? parseFloat(tr._cellRefs[qtyField].el.value) || 0 : 0;
    const price = priceField ? parseFloat(tr._cellRefs[priceField].el.value) || 0 : 0;

    const updates = runLineRules("*", { __qty: qty, __price: price }, { changedFields: ["__qty", "__price"] });
    total += updates.__subtotal || 0;
  });
  return total;
}

function getCurrencySymbolInfo(currencyRecord) {
  if (!currencyRecord) return { symbol: "", position: "after" };
  return {
    symbol: currencyRecord.symbol || currencyRecord.display_name || "",
    position: currencyRecord.position === "before" ? "before" : "after",
  };
}

function formatAmount(total) {
  return total.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatMonetaryTotal(total, currencyInfo) {
  const amount = formatAmount(total);
  if (!currencyInfo.symbol) return `Total: ${amount}`;
  return currencyInfo.position === "before"
    ? `Total: ${currencyInfo.symbol} ${amount}`
    : `Total: ${amount} ${currencyInfo.symbol}`;
}

/**
 * Enables automatic recalculation for a One2many field.
 * @returns {Function} A manual recalculation function (e.g., after adding a
 * line via the product catalog).
 */
export function attachComputeEngine(tbody, totalDisplayEl, parentValues) {
  let currencyInfo = { symbol: "", position: "after" };

  function recompute() {
    const total = computeTotalFromRows(tbody);
    totalDisplayEl.textContent = formatMonetaryTotal(total, currencyInfo);
    return total;
  }

  tbody.addEventListener("input", recompute);
  recompute();

  const currencyId = parentValues && parentValues.currency_id;
  if (currencyId) {
    getReferenceRecords("res.currency")
      .then((currencies) => {
        const found = currencies.find((c) => c.id === currencyId);
        if (found) {
          currencyInfo = getCurrencySymbolInfo(found);
          recompute();
        }
      })
      .catch((err) => console.warn("Impossible de résoudre la devise:", err));
  }

  return recompute;
}
