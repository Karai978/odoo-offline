/**
 * business_rules/purchase_rules.js
 * =================================
 * Règles métier "Achats complets" (purchase.order + purchase.order.line)
 * pour le moteur offline — équivalent JS explicite des @api.depends /
 * @api.onchange / @api.constrains Python d'Odoo 17
 * (addons/purchase/models/purchase_order.py & purchase_order_line.py),
 * enregistrés dans les registres business_rules_registry.js.
 *
 * Importé une seule fois au démarrage dans main.js (effet de bord).
 *
 * LIMITES OFFLINE DOCUMENTÉES (docs/odoo17-business-rules-digest.md) :
 *  - prix fournisseur : product._select_seller() est un calcul serveur
 *    (seller_ids + devise + UoM + délai). Repli offline :
 *    price_unit = product.standard_price ; date_planned = date_order +
 *    product.delay (si présent) ; discount conservé/à 0.
 *  - pas de moteur de taxes → price_tax = 0 sur les lignes (re)calculées.
 *  - fiscal position : approximation par pays du partner.
 */

import {
  onchangeRegistry,
  constraintsRegistry,
  fieldComputeRegistry,
} from "../model/relational_model/business_rules_registry.js";
import { asM2o, m2oId, displayOf, isMissingRecord, fposForPartner, partnerWarning, sumLineField, defaultLineSubtotal } from "./rules_helpers.js";

/* ================================================================== */
/* purchase.order — onchange partner_id (méthode source Odoo 17)       */
/* ================================================================== */

// onchange_partner_id : fpos + property_supplier_payment_term_id +
// property_purchase_currency_id + buyer_id ; sans partner : fpos=False,
// devise = devise société.
onchangeRegistry.add("purchase.order:partner_id", async (partnerId, values, helpers) => {
  const patch = {};

  if (!partnerId || typeof partnerId === "string") {
    patch.fiscal_position_id = false;
    const cur = asM2o(values.currency_id); // laisser la devise existante si connue
    if (!cur || !cur.id) {
      const companyCur = await companyCurrency(values, helpers);
      if (companyCur && companyCur.id) patch.currency_id = companyCur;
    }
    return patch;
  }

  let partner = null;
  try {
    partner = await helpers.getRecordSmart("res.partner", partnerId, helpers.apiKey, helpers.baseUrl);
  } catch (err) {
    return null;
  }
  if (isMissingRecord(partner)) return null; // sentinel "non disponible" : ne rien écraser

  // fiscal_position_id = fpos._get_fiscal_position(partner) — approximation
  const fpos = await fposForPartner(partner, helpers);
  patch.fiscal_position_id = fpos && fpos.id ? fpos : false;

  // payment_term_id = partner.property_supplier_payment_term_id
  const term = asM2o(partner.property_supplier_payment_term_id);
  if (term && term.id) {
    const refs = await helpers.getReferenceRecordsSmart("account.payment.term", helpers.apiKey, helpers.baseUrl);
    patch.payment_term_id = { id: term.id, display_name: displayOf(refs, term.id) || term.display_name };
  } else {
    patch.payment_term_id = false;
  }

  // currency_id = partner.property_purchase_currency_id or company.currency_id
  const partnerCur = asM2o(partner.property_purchase_currency_id);
  const cur = partnerCur && partnerCur.id
    ? await currencyM2o(partnerCur.id, helpers)
    : await companyCurrency(values, helpers);
  if (cur && cur.id) patch.currency_id = cur;

  // user_id = partner.buyer_id (si défini)
  const buyer = asM2o(partner.buyer_id);
  if (buyer && buyer.id) {
    const refs = await helpers.getReferenceRecordsSmart("res.users", helpers.apiKey, helpers.baseUrl);
    patch.user_id = { id: buyer.id, display_name: displayOf(refs, buyer.id) || buyer.display_name };
  }

  return patch;
});

// onchange_partner_id_warning : partner.purchase_warn (block → reset)
onchangeRegistry.add("purchase.order:partner_id#partner_warn", async (partnerId, values, helpers) => {
  if (!partnerId || typeof partnerId === "string") return null;
  let partner = null;
  try {
    partner = await helpers.getRecordSmart("res.partner", partnerId, helpers.apiKey, helpers.baseUrl);
  } catch (err) {
    return null;
  }
  if (isMissingRecord(partner)) return null;
  const warning = await partnerWarning(partner, "purchase_warn", helpers);
  if (!warning) return null;
  if (warning.block) {
    return { partner_id: false, _warning: { title: warning.title, message: warning.message, block: true } };
  }
  return { _warning: warning };
});

/* ================================================================== */
/* purchase.order — date_planned                                       */
/* ================================================================== */

// onchange_date_planned : propage la date planifiée du document sur toutes
// les lignes (non-section).
onchangeRegistry.add("purchase.order:date_planned", (datePlanned, values) => {
  if (!datePlanned) return null;
  const lines = values.order_line;
  if (!Array.isArray(lines) || lines.length === 0) return null;
  let changed = false;
  const newLines = lines.map((line) => {
    if (!line || line.display_type) return line;
    if (line.date_planned === datePlanned) return line;
    changed = true;
    return { ...line, date_planned: datePlanned };
  });
  return changed ? { order_line: newLines } : null;
});

// _compute_date_planned : min des date_planned des lignes
fieldComputeRegistry.add("purchase.order:date_planned", (values) => {
  const lines = values.order_line;
  if (!Array.isArray(lines)) return undefined;
  const dates = lines
    .filter((l) => l && !l.display_type && l.date_planned)
    .map((l) => String(l.date_planned).slice(0, 10));
  return dates.length ? dates.sort()[0] : undefined;
});

// _compute_amounts (même convention que ventes : pas de tax engine)
fieldComputeRegistry.add("purchase.order:amount_untaxed", (values) => sumLineField(values.order_line, "price_subtotal", defaultLineSubtotal));
fieldComputeRegistry.add("purchase.order:amount_tax", (values) => sumLineField(values.order_line, "price_tax"));
fieldComputeRegistry.add("purchase.order:amount_total", (values) =>
  sumLineField(values.order_line, "price_subtotal", defaultLineSubtotal) + sumLineField(values.order_line, "price_tax")
);

/* ================================================================== */
/* purchase.order — contrainte locale                                  */
/* ================================================================== */

constraintsRegistry.add("purchase.order", (values) => {
  // _check_order_line_company_id (simplifié : comparaison d'id de société,
  // sans le calcul de branche _accessible_branches qui est serveur).
  if (values.company_id && Array.isArray(values.order_line)) {
    const docCompanyId = m2oId(values.company_id);
    const otherCompany = values.order_line.find(
      (l) => l && l.display_type !== true && l.product_company_id && m2oId(l.product_company_id) && String(m2oId(l.product_company_id)) !== String(docCompanyId)
    );
    if (otherCompany) {
      return "Votre bon de commande contient des produits d'une autre société — changez la société du document ou retirez ces produits.";
    }
  }
  return null;
});

/* ================================================================== */
/* purchase.order.line — onchange produit (backfill de ligne)          */
/* ================================================================== */

// onchange_product_id + _product_id_change +
// _compute_price_unit_and_date_planned_and_name — portés en "backfill"
// (mêmes conditions que le portage Ventes : idempotent, ne touche pas une
// ligne déjà complète).
onchangeRegistry.add("purchase.order:order_line#product", async (lines, values, helpers) => {
  if (!Array.isArray(lines)) return null;

  let refsUom = null;
  let changed = false;
  const orderDate = values.date_order ? String(values.date_order).slice(0, 10) : null;

  const filled = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (!line) { filled.push(line); continue; }
    const pid = line.product_id;
    if (!pid || typeof pid === "string") { filled.push(line); continue; }

    const needsFill =
      !line.name ||
      (line.price_unit === undefined || line.price_unit === false || line.price_unit === 0) ||
      !line.product_uom ||
      (Array.isArray(line.tax_ids) ? line.tax_ids.length === 0 : !line.tax_ids) ||
      (Array.isArray(line.taxes_id) ? line.taxes_id.length === 0 : !line.taxes_id);
    if (!needsFill) { filled.push(line); continue; }

    let product = null;
    try {
      product = await helpers.getRecordSmart("product.product", pid, helpers.apiKey, helpers.baseUrl);
    } catch (err) {
      filled.push(line);
      continue;
    }
    if (isMissingRecord(product)) { filled.push(line); continue; }

    const updated = { ...line };
    if (!updated.name) updated.name = product.description_purchase || product.name || "";

    // _product_id_change : product_uom = product.uom_po_id or product.uom_id
    const uom = asM2o(product.uom_po_id) || asM2o(product.uom_id);
    if (uom && uom.id && !line.product_uom) {
      if (!refsUom) refsUom = await helpers.getReferenceRecordsSmart("product.uom", helpers.apiKey, helpers.baseUrl);
      updated.product_uom = { id: uom.id, display_name: displayOf(refsUom, uom.id) || uom.display_name };
    }

    // taxes : supplier_taxes_id (repli taxes_id)
    const taxes = Array.isArray(product.supplier_taxes_id) && product.supplier_taxes_id.length
      ? product.supplier_taxes_id
      : product.taxes_id;
    if (taxes && taxes.length) {
      const normalized = taxes.map((t) => (Array.isArray(t) ? t : [t, t]));
      if ("tax_ids" in updated && (!Array.isArray(updated.tax_ids) || updated.tax_ids.length === 0)) updated.tax_ids = normalized;
      if ("taxes_id" in updated && (!Array.isArray(updated.taxes_id) || updated.taxes_id.length === 0)) updated.taxes_id = normalized;
    }

    // prix : pas de seller_ids offline → standard_price
    if (line.price_unit === undefined || line.price_unit === false || line.price_unit === 0) {
      updated.price_unit = Number(product.standard_price) || 0;
    }

    // date_planned = date_order + délai (seller.delay côté serveur,
    // repli product.delay)
    if (!line.date_planned && orderDate) {
      const delay = Number(product.delay) || 0;
      const d = new Date(orderDate + "T00:00:00");
      d.setDate(d.getDate() + delay);
      updated.date_planned = d.toISOString().slice(0, 10);
    }

    // _compute_amount (approximation sans tax engine)
    const qty = Number(updated.product_qty) || Number(updated.product_uom_qty) || 0;
    const price = Number(updated.price_unit) || 0;
    const discount = Number(updated.discount) || 0;
    const subtotal = Number((qty * price * (1 - discount / 100)).toFixed(2));
    updated.price_subtotal = subtotal;
    if (updated.price_tax === undefined || updated.price_tax === false) updated.price_tax = 0;
    updated.price_total = Number((subtotal + (Number(updated.price_tax) || 0)).toFixed(2));
    if (updated.price_unit_discounted === undefined) {
      updated.price_unit_discounted = Number((price * (1 - discount / 100)).toFixed(2));
    }

    changed = true;
    filled.push(updated);
  }

  return changed ? { order_line: filled } : null;
});

// onchange_product_id_warning : product.purchase_line_warn
onchangeRegistry.add("purchase.order:order_line#product_warn", async (lines, values, helpers) => {
  if (!Array.isArray(lines)) return null;
  for (const line of lines) {
    const pid = line && line.product_id;
    if (!pid || typeof pid === "string") continue;
    let product = null;
    try {
      product = await helpers.getRecordSmart("product.product", pid, helpers.apiKey, helpers.baseUrl);
    } catch (err) {
      continue;
    }
    if (product && product.purchase_line_warn && product.purchase_line_warn !== "no-message") {
      if (product.purchase_line_warn === "block") {
        return {
          _warning: {
            title: `Warning for ${product.display_name || product.name}`,
            message: product.purchase_line_warn_msg || "",
            block: true,
          },
        };
      }
      return {
        _warning: {
          title: `Warning for ${product.display_name || product.name}`,
          message: product.purchase_line_warn_msg || "",
        },
      };
    }
  }
  return null;
});

/* ================================================================== */
/* Helpers internes au domaine Achats                                  */
/* ================================================================== */

async function currencyM2o(currencyId, helpers) {
  const refs = await helpers.getReferenceRecordsSmart("res.currency", helpers.apiKey, helpers.baseUrl);
  const display = displayOf(refs, currencyId);
  return { id: currencyId, display_name: display };
}

async function companyCurrency(values, helpers) {
  const companyId = m2oId(values.company_id);
  if (!companyId) return false;
  try {
    const company = await helpers.getRecordSmart("res.company", companyId, helpers.apiKey, helpers.baseUrl);
    if (isMissingRecord(company)) return false;
    const cur = asM2o(company && company.currency_id);
    if (!cur || !cur.id) return false;
    return currencyM2o(cur.id, helpers);
  } catch (err) {
    return false;
  }
}
