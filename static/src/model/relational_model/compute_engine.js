/**
 * model/relational_model/compute_engine.js
 * Real-time recalculation of the
 * total of a One2many field (e.g., order lines), resolving
 * the parent document's currency.
 */

import { getReferenceRecords } from "../../core/name_service.js";
import { computeRegistry } from "./business_rules_registry.js";
import { getCharFieldValue } from "../../views/fields/char/char_field.js";

// Cas connus livrés avec le moteur — avant, ces noms de champs étaient
// devinés à l'aveugle pour N'IMPORTE QUEL sous-modèle (voir ancien code).
// Ici, ils sont déclarés explicitement pour les deux seuls modèles
// pour lesquels le calcul est réellement correct. Toute app métier peut
// enregistrer d'autres modèles via computeRegistry.add(...) ailleurs.
computeRegistry.add("sale.order.line", (rows) =>
  rows.reduce((sum, r) => sum + (r.product_uom_qty || 0) * (r.price_unit || 0), 0)
);
computeRegistry.add("purchase.order.line", (rows) =>
  rows.reduce((sum, r) => sum + (r.product_qty || 0) * (r.price_unit || 0), 0)
);
computeRegistry.add("account.move.line", (rows) =>
  rows.reduce((sum, r) => sum + (r.quantity || 0) * (r.price_unit || 0), 0)
);

/**
 * Récupère les valeurs brutes de chaque ligne (une seule fois, sous forme
 * de dict {champ: valeur}), puis délègue le calcul du total à la fonction
 * enregistrée pour ce sous-modèle. Retourne null si aucune règle n'est
 * connue — mieux vaut ne rien afficher qu'afficher un total probablement
 * faux pour un modèle non prévu.
 */
function computeTotalFromRows(tbody, comodelName) {
  const computeFn = computeRegistry.get(comodelName, null);
  if (!computeFn) return null;

  const rows = Array.from(tbody.querySelectorAll("tr"))
    .filter((tr) => tr._cellRefs)
    .map((tr) => {
      const values = {};
      for (const [fieldName, ref] of Object.entries(tr._cellRefs)) {
        const rawValue = ref.info?.type === "char"
          ? getCharFieldValue(ref.el)
          : ref.el?.value ?? ref.el?.querySelector?.("input, select, textarea")?.value;
        values[fieldName] = parseFloat(rawValue) || 0;
      }
      return values;
    });

  return computeFn(rows);
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
export function attachComputeEngine(tbody, totalDisplayEl, parentValues, comodelName) {
  let currencyInfo = { symbol: "", position: "after" };

  function recompute() {
    const total = computeTotalFromRows(tbody, comodelName);
    if (total === null) {
      totalDisplayEl.textContent = "";
      return null;
    }
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
