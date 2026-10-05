/**
 * model/relational_model/compute_engine.js
 * Real-time recalculation of the total of a One2many field (e.g., order
 * lines), with the line TAXES resolved by the offline tax engine
 * (business_rules/rules_helpers.js) and the parent document's currency.
 *
 * Le pied de tableau affiche le TOTAL avec taxes : la vue standard ne
 * rend pas de colonnes price_tax / price_total, donc le montant de taxe
 * de chaque ligne est résolu à la volée :
 *  1. record(s) account.tax lisible(s) → calcul du moteur approximatif ;
 *  2. ids de taxes déclarés mais record(s) absent(s) du cache (offline)
 *     → price_tax SERVEUR de la ligne initiale (tr._serverData), mise à
 *     l'échelle du nouveau sous-total ;
 *  3. pas de taxe → 0.
 */

import { getReferenceRecords } from "../../core/name_service.js";
import { getApiKey, CONFIG } from "../../core/browser/session.js";
import { computeRegistry } from "./business_rules_registry.js";
import { lineSubtotalOf, lineTaxIds, resolveLineTax } from "../../business_rules/rules_helpers.js";

/** Helpers réseau minimum pour resolveLineTax (cache d'abord, réseau ensuite). */
function taxHelpers() {
  return { apiKey: getApiKey(), baseUrl: CONFIG.ODOO_BASE_URL };
}

/**
 * Total d'un one2many de LIGNES (commande / facture) : somme, ligne par
 * ligne, du sous-total + taxe (les lignes TTC — price_include — n'ajoutent
 * pas la taxe au total, comme côté serveur).
 */
async function lineTotalWithTax(rows, qtyField) {
  let total = 0;
  for (const r of rows || []) {
    if (!r || r.display_type) continue; // sections / notes
    const collectedSub = Number(r.price_subtotal) || 0;
    const subtotal = collectedSub > 0 ? collectedSub : lineSubtotalOf(r, qtyField);
    const taxIds = lineTaxIds(r);
    if (!taxIds.length) {
      // pas de taxe déclarée : une colonne price_tax rendue fait foi
      // (les règles de lignes la mettent à 0 si la taxe est retirée)
      const t = Number(r.price_tax);
      total += isFinite(t) && r.price_tax !== undefined && r.price_tax !== false
        ? subtotal + (isNaN(t) ? 0 : t)
        : subtotal;
      continue;
    }
    const res = await resolveLineTax(taxIds, subtotal, Number(r[qtyField]) || 0, r._serverData || null, taxHelpers());
    total += res.included ? subtotal : subtotal + res.tax;
  }
  return Number(total.toFixed(2));
}

// Cas connus livrés avec le moteur — avant, ces noms de champs étaient
// devinés à l'aveugle pour N'IMPORTE QUEL sous-modèle (voir ancien code).
// Ici, ils sont déclarés explicitement pour les seuls modèles pour
// lesquels le calcul est réellement correct. Toute app métier peut
// enregistrer d'autres modèles via computeRegistry.add(...) ailleurs.
computeRegistry.add("sale.order.line", (rows) => lineTotalWithTax(rows, "product_uom_qty"));
computeRegistry.add("purchase.order.line", (rows) => lineTotalWithTax(rows, "product_qty"));
computeRegistry.add("account.move.line", (rows) => lineTotalWithTax(rows, "quantity"));

/**
 * Récupère les valeurs brutes de chaque ligne (une seule fois, sous forme
 * de dict {champ: valeur}) : numériques pour les colonnes numériques, id
 * (many2one) / liste d'ids (many2many) pour les colonnes taxonomiques,
 * plus les données complètes initiales de la ligne (_serverData) pour le
 * repli hors-ligne des taxes. Délègue ensuite le calcul du total à la
 * fonction enregistrée pour ce sous-modèle (synchrone ou async).
 * Retourne null si aucune règle n'est connue — mieux vaut ne rien
 * afficher qu'afficher un total probablement faux pour un modèle non prévu.
 */
async function computeTotalFromRows(tbody, comodelName) {
  const computeFn = computeRegistry.get(comodelName, null);
  if (!computeFn) return null;

  const rows = Array.from(tbody.querySelectorAll("tr"))
    .filter((tr) => tr._cellRefs)
    .map((tr) => {
      const values = {};
      for (const [fieldName, ref] of Object.entries(tr._cellRefs)) {
        if (ref.info && ref.info.type === "many2one") {
          const hidden = typeof ref.el.querySelector === "function" ? ref.el.querySelector('input[type="hidden"]') : null;
          const raw = hidden ? hidden.value : "";
          values[fieldName] = raw ? (raw.startsWith("tmp:") ? raw : parseInt(raw, 10)) : false;
        } else if (ref.info && ref.info.type === "many2many") {
          const hidden = typeof ref.el.querySelector === "function" ? ref.el.querySelector('input[type="hidden"]') : null;
          let ids = [];
          if (hidden && hidden.value) {
            try { ids = JSON.parse(hidden.value); } catch (e) { ids = []; }
          }
          values[fieldName] = ids;
        } else {
          const input =
            typeof ref.el.matches === "function" && ref.el.matches("input, select, textarea")
              ? ref.el
              : (typeof ref.el.querySelector === "function" ? ref.el.querySelector("input, select, textarea") : null);
          values[fieldName] = input ? (parseFloat(input.value) || 0) : 0;
        }
      }
      values._serverData = tr._serverData || null;
      return values;
    });

  return await computeFn(rows);
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
  let computing = false;

  async function recompute() {
    // Un seul calcul en vol à la fois : la résolution des taxes est
    // asynchrone (lecture du cache IndexedDB) — un input rapide ne doit
    // pas empiler des recalculs qui se marcheraient dessus.
    if (computing) return null;
    computing = true;
    try {
      const total = await computeTotalFromRows(tbody, comodelName);
      if (total === null) {
        totalDisplayEl.textContent = "";
        return null;
      }
      totalDisplayEl.textContent = formatMonetaryTotal(total, currencyInfo);
      return total;
    } finally {
      computing = false;
    }
  }

  // "input" : frappe utilisateur. "change" : écritures programmées (backfill
  // des règles de lignes — prix, taxes, désignation) — les deux sont
  // nécessaires, sinon le total ne se met à jour que quand l'utilisateur
  // retape dans une cellule.
  tbody.addEventListener("input", recompute);
  tbody.addEventListener("change", recompute);
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
