/**
 * business_rules/account_rules.js
 * ================================
 * Règles métier "Facturation complète" (account.move +
 * account.move.line) pour le moteur offline — équivalent JS explicite des
 * @api.depends / @api.onchange Python d'Odoo 17
 * (addons/account/models/account_move.py & account_move_line.py),
 * enregistrés dans les registres business_rules_registry.js.
 *
 * Importé une seule fois au démarrage dans main.js (effet de bord).
 *
 * LIMITES OFFLINE DOCUMENTÉES (docs/odoo17-business-rules-digest.md) :
 *  - pas de moteur de taxes → price_tax = 0 sur les lignes (re)calculées,
 *    totaux = somme des lignes ;
 *  - journal par défaut par type : choix du premier journal (type, société)
 *    du cache de référence — l'ordre de séquence exact est serveur ;
 *  - échéancier (invoice_date_due) : non recalculé (nécessite les
 *    échéances du compte de conditions de paiement, calcul serveur) ;
 *  - adresses : repli sur le partner (address_get() est serveur).
 */

import {
  onchangeRegistry,
  fieldComputeRegistry,
} from "../model/relational_model/business_rules_registry.js";
import { asM2o, m2oId, displayOf, isMissingRecord, fposForPartner, partnerWarning, docLinesAmounts, lineTaxIds, getTaxRecord, computeTaxAmounts } from "./rules_helpers.js";

const SALE_TYPES = ["out_invoice", "out_refund"];
const PURCHASE_TYPES = ["in_invoice", "in_refund", "in_receipt"];

/* ================================================================== */
/* Helpers internes au domaine Comptabilité                            */
/* ================================================================== */

async function companyOf(values, helpers) {
  const companyId = m2oId(values.company_id);
  if (!companyId) return null;
  try {
    const company = await helpers.getRecordSmart("res.company", companyId, helpers.apiKey, helpers.baseUrl);
    return isMissingRecord(company) ? null : company;
  } catch (err) {
    return null;
  }
}

/* ================================================================== */
/* account.move — onchange partner_id                                  */
/* ================================================================== */

// _compute_invoice_payment_term_id + _compute_partner_shipping_id +
// _compute_fiscal_position_id + _compute_narration + _onchange_partner_id
// (invoice_warn).
onchangeRegistry.add("account.move:partner_id", async (partnerId, values, helpers) => {
  if (!partnerId || typeof partnerId === "string") return null;

  let partner = null;
  try {
    partner = await helpers.getRecordSmart("res.partner", partnerId, helpers.apiKey, helpers.baseUrl);
  } catch (err) {
    return null;
  }
  if (isMissingRecord(partner)) return null; // sentinel "non disponible" : ne rien écraser

  const patch = {};
  const moveType = values.move_type;
  const isSale = SALE_TYPES.includes(moveType);
  const isPurchase = PURCHASE_TYPES.includes(moveType);

  // _compute_invoice_payment_term_id
  const termRaw = isSale
    ? partner.property_payment_term_id
    : isPurchase
      ? partner.property_supplier_payment_term_id
      : false;
  const term = asM2o(termRaw);
  if (term && term.id) {
    const refs = await helpers.getReferenceRecordsSmart("account.payment.term", helpers.apiKey, helpers.baseUrl);
    patch.invoice_payment_term_id = { id: term.id, display_name: displayOf(refs, term.id) || term.display_name };
  } else if (isSale || isPurchase) {
    patch.invoice_payment_term_id = false;
  }

  // _compute_partner_shipping_id (approximation : le partner lui-même)
  patch.partner_shipping_id = { id: partnerId, display_name: partner.display_name || partner.name || "" };

  // _compute_fiscal_position_id (approximation par pays)
  const fpos = await fposForPartner(partner, helpers);
  patch.fiscal_position_id = fpos && fpos.id ? fpos : false;

  // _compute_narration : conditions générales de la société (docs de vente)
  if (isSale) {
    const company = await companyOf(values, helpers);
    const terms = company && (company.invoice_terms || company.invoice_terms_html);
    if (terms) patch.narration = terms;
  }

  return patch;
});

// _onchange_partner_id : invoice_warn (block → reset du partner)
onchangeRegistry.add("account.move:partner_id#partner_warn", async (partnerId, values, helpers) => {
  if (!partnerId || typeof partnerId === "string") return null;
  let partner = null;
  try {
    partner = await helpers.getRecordSmart("res.partner", partnerId, helpers.apiKey, helpers.baseUrl);
  } catch (err) {
    return null;
  }
  if (isMissingRecord(partner)) return null;
  const warning = await partnerWarning(partner, "invoice_warn", helpers);
  if (!warning) return null;
  if (warning.block) {
    return { partner_id: false, _warning: { title: warning.title, message: warning.message, block: true } };
  }
  return { _warning: warning };
});

/* ================================================================== */
/* account.move — journal / devise / type                              */
/* ================================================================== */

// _inverse_journal_id : company_id = journal.company_id ;
// currency_id = journal.currency_id (si définie).
onchangeRegistry.add("account.move:journal_id", async (journalId, values, helpers) => {
  if (!journalId || typeof journalId === "string") return null;
  let journal = null;
  try {
    journal = await helpers.getRecordSmart("account.journal", journalId, helpers.apiKey, helpers.baseUrl);
  } catch (err) {
    return null;
  }
  if (isMissingRecord(journal)) return null;

  const patch = {};
  const company = asM2o(journal.company_id);
  if (company && company.id) {
    const refs = await helpers.getReferenceRecordsSmart("res.company", helpers.apiKey, helpers.baseUrl);
    patch.company_id = { id: company.id, display_name: displayOf(refs, company.id) || company.display_name };
  }
  const cur = asM2o(journal.currency_id);
  if (cur && cur.id) {
    const refs = await helpers.getReferenceRecordsSmart("res.currency", helpers.apiKey, helpers.baseUrl);
    patch.currency_id = { id: cur.id, display_name: displayOf(refs, cur.id) || cur.display_name };
  }
  return Object.keys(patch).length ? patch : null;
});

// _onchange_move_type : journal par défaut du type (premier journal du
// cache de référence dont le type et la société correspondent).
// Type Odoo attendu : sale (out_*) / purchase (in_*).
onchangeRegistry.add("account.move:move_type", async (moveType, values, helpers) => {
  const wantedType = SALE_TYPES.includes(moveType) ? "sale" : PURCHASE_TYPES.includes(moveType) ? "purchase" : null;
  if (!wantedType) return null;

  let refs = [];
  try {
    refs = await helpers.getReferenceRecordsSmart("account.journal", helpers.apiKey, helpers.baseUrl);
  } catch (err) {
    return null;
  }
  if (!refs.length) return null;

  const companyId = m2oId(values.company_id);
  for (const ref of refs) {
    try {
      const journal = await helpers.getRecordSmart("account.journal", ref.id, helpers.apiKey, helpers.baseUrl);
      if (isMissingRecord(journal) || journal.type !== wantedType) continue;
      if (companyId && String(m2oId(journal.company_id)) !== String(companyId)) continue;
      return { journal_id: { id: ref.id, display_name: ref.display_name } };
    } catch (err) {
      /* journal non en cache — on passe au suivant */
    }
  }
  return null;
});

// _compute_currency_id : journal.currency_id or company.currency_id
onchangeRegistry.add("account.move:journal_id#currency", async (journalId, values, helpers) => {
  // La règle "account.move:journal_id" ci-dessus applique déjà la devise du
  // journal quand elle existe ; cette règle est le repli devise société
  // quand le journal n'en définit pas (pas de patch de sa part).
  if (journalId && typeof journalId !== "string") {
    try {
      const journal = await helpers.getRecordSmart("account.journal", journalId, helpers.apiKey, helpers.baseUrl);
      if (journal && asM2o(journal.currency_id) && asM2o(journal.currency_id).id) return null; // géré par l'autre règle
    } catch (err) {
      /* on continue avec la devise société */
    }
  }
  const company = await companyOf(values, helpers);
  const cur = asM2o(company && company.currency_id);
  if (!cur || !cur.id) return null;
  const refs = await helpers.getReferenceRecordsSmart("res.currency", helpers.apiKey, helpers.baseUrl);
  return { currency_id: { id: cur.id, display_name: displayOf(refs, cur.id) || cur.display_name } };
});

/* ================================================================== */
/* account.move — compute des montants                                 */
/* ================================================================== */

// _compute_amount : somme des lignes AVEC taxes (la vue ne rendant pas
// de colonnes price_tax/price_total, la taxe de chaque ligne est résolue
// par le moteur offline, avec repli sur la price_tax serveur de la ligne
// initiale en hors-ligne).
fieldComputeRegistry.add("account.move:amount_total", async (values, helpers, containerEl) =>
  (await docLinesAmounts(values, containerEl, "invoice_line_ids", "quantity", helpers)).total
);
fieldComputeRegistry.add("account.move:amount_tax", async (values, helpers, containerEl) =>
  (await docLinesAmounts(values, containerEl, "invoice_line_ids", "quantity", helpers)).tax
);
fieldComputeRegistry.add("account.move:amount_untaxed", async (values, helpers, containerEl) =>
  (await docLinesAmounts(values, containerEl, "invoice_line_ids", "quantity", helpers)).untaxed
);

// _compute_direction_sign : 1 outbound / -1 inbound
fieldComputeRegistry.add("account.move:direction_sign", (values) => {
  const t = values.move_type;
  if (!t) return undefined;
  return t === "entry" || SALE_TYPES.includes(t) ? 1 : -1;
});

/* ================================================================== */
/* account.move.line — onchange produit (backfill de ligne)            */
/* ================================================================== */

// _compute_name + _compute_tax_ids + prix — portés en "backfill"
// (idempotent : ne touche pas une ligne déjà complète).
onchangeRegistry.add("account.move:invoice_line_ids#product", async (lines, values, helpers) => {
  if (!Array.isArray(lines)) return null;

  const moveType = values.move_type;
  const isSale = SALE_TYPES.includes(moveType);
  let changed = false;

  // Vide = undefined/false/null/"" ou tableau vide (un prix volontairement
  // 0 est conservé). Une colonne ABSENTE de la vue ne doit JAMAIS rendre
  // la ligne « incomplète » (boucle de refetch sinon).
  const isEmptyCell = (v) =>
    Array.isArray(v) ? v.length === 0 : v === undefined || v === false || v === null || v === "";

  const filled = [];
  for (const line of lines) {
    if (!line) { filled.push(line); continue; }
    const pid = line.product_id;
    if (!pid || typeof pid === "string") { filled.push(line); continue; }

    const needsFill =
      ("name" in line && isEmptyCell(line.name)) ||
      ("price_unit" in line && isEmptyCell(line.price_unit)) ||
      ("tax_ids" in line && isEmptyCell(line.tax_ids));

    let product = null;
    if (needsFill) {
      try {
        product = await helpers.getRecordSmart("product.product", pid, helpers.apiKey, helpers.baseUrl);
      } catch (err) {
        product = null;
      }
      if (isMissingRecord(product)) { filled.push(line); continue; }
    }

    const updated = { ...line };
    if (needsFill && product) {
      // _compute_name : partner_ref + description_sale (journal vente)
      // / description_purchase (journal achat)
      const parts = [];
      if (product.partner_ref) parts.push(product.partner_ref);
      const desc = isSale ? product.description_sale : product.description_purchase;
      if (desc) parts.push(desc);
      if (!updated.name && parts.length) updated.name = parts.join("\n");
      else if (!updated.name) updated.name = product.name || "";

      // taxes : taxes_id du produit (le filtre par pays du partner —
      // _compute_tax_ids — est un calcul serveur ; approximation : taxes
      // brutes du produit, documenté). tax_ids = many2many (tags).
      const taxes = Array.isArray(product.taxes_id) ? product.taxes_id : [];
      if (taxes.length && "tax_ids" in updated && isEmptyCell(line.tax_ids)) {
        updated.tax_ids = taxes.map((t) => (Array.isArray(t) ? t : [t, t]));
      }

      // prix : list_price (vente) / standard_price (achat)
      if ("price_unit" in updated && isEmptyCell(line.price_unit)) {
        updated.price_unit = Number(isSale ? product.list_price : product.standard_price) || 0;
      }
    }

    // ---- _compute_price_subtotal / _compute_price_total + taxes ----
    // (toujours recalculé, idempotent)
    const qty = Number(updated.quantity) || Number(updated.product_uom_qty) || 0;
    const price = Number(updated.price_unit) || 0;
    const discount = Number(updated.discount) || 0;
    const subtotal = Number((qty * price * (1 - discount / 100)).toFixed(2));

    // taxes : toutes les colonnes taxes rendues (tax_ids m2m, taxes_id /
    // tax_id selon la vue). Quatre cas : id(s) connu(s) + record(s)
    // lisible(s) → calcul ; id déclaré mais record non en cache (offline)
    // → valeur serveur conservée ; colonne vide → 0 ; colonne absente →
    // valeur serveur conservée.
    const hasTaxCol = ["tax_id", "taxes_id", "tax_ids"].some((f) => f in line || f in updated);
    let taxAmount;
    const num2 = (v) => (v === undefined || v === false || v === null ? 0 : Number(v) || 0);
    const taxIds = hasTaxCol ? lineTaxIds(updated) : [];
    if (taxIds.length) {
      const taxRecords = [];
      for (const tid of taxIds) {
        const rec = await getTaxRecord(tid, helpers);
        if (rec) taxRecords.push(rec);
      }
      if (taxRecords.length) {
        const { tax_amount, included } = computeTaxAmounts(subtotal, qty, taxRecords);
        taxAmount = tax_amount;
        updated.price_tax = taxAmount;
        updated.price_total = Number((included ? subtotal : subtotal + taxAmount).toFixed(2));
      } else {
        // taxe déclarée mais pas en cache (offline) → valeur serveur conservée
        taxAmount = num2(line.price_tax);
        updated.price_total = Number((subtotal + taxAmount).toFixed(2));
      }
    } else if (hasTaxCol) {
      taxAmount = 0;
      updated.price_tax = 0;
      updated.price_total = subtotal;
    } else {
      // colonne taxe absente de la vue : valeur serveur conservée
      taxAmount = num2(line.price_tax);
      updated.price_total = Number((subtotal + taxAmount).toFixed(2));
    }
    updated.price_subtotal = subtotal;

    // Idempotence : montants inchangés et rien à remplir → ligne telle
    // quelle. Un montant ABSENT de la vue (colonne non rendue → non
    // collectée) ne doit pas casser l'idempotence : on ne compare que
    // les clés présentes dans la ligne collectée.
    const sameMoney = (a, b) => num2(a).toFixed(2) === num2(b).toFixed(2);
    const fillApplied = needsFill && !!product;
    const idemSub = !("price_subtotal" in line) || sameMoney(subtotal, line.price_subtotal);
    const idemTax = !("price_tax" in line) || sameMoney(taxAmount, line.price_tax);
    const idemTot = !("price_total" in line) || sameMoney(updated.price_total, line.price_total);
    if (!fillApplied && idemSub && idemTax && idemTot) {
      filled.push(line);
      continue;
    }
    changed = true;
    filled.push(updated);
  }

  return changed ? { invoice_line_ids: filled } : null;
});
