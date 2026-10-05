/**
 * business_rules/sale_rules.js
 * ============================
 * Règles métier "Ventes complètes" (sale.order + sale.order.line) pour le
 * moteur offline — équivalent JS explicite des @api.depends / @api.onchange
 * / @api.constrains Python d'Odoo 17 (addons/sale + addons/sale_management),
 * enregistrés dans les registres business_rules_registry.js.
 *
 * Importé une seule fois au démarrage dans main.js (effet de bord).
 *
 * LIMITES OFFLINE DOCUMENTÉES (voir docs/odoo17-business-rules-digest.md) :
 *  - pas de pricelist → price_unit repli sur product.list_price ;
 *  - pas de moteur de taxes → price_tax = 0 sur les lignes (re)calculées,
 *    les totaux document = somme des lignes ;
 *  - pas de taux de change → currency_rate non reculé ;
 *  - fiscal position : approximation par pays du partner (voir
 *    rules_helpers.fposForPartner) ;
 *  - adresses de facturation/livraison : repli sur le partner lui-même
 *    (address_get() est un calcul serveur sur les contacts).
 *
 * Cet fichier remplace business_rules/sale_order_rules.js (exemple initial,
 * conservé en stub — voir son en-tête).
 */

import { notify } from "../core/notification_service.js";
import {
  onchangeRegistry,
  constraintsRegistry,
  fieldComputeRegistry,
} from "../model/relational_model/business_rules_registry.js";
import { asM2o, m2oId, displayOf, isMissingRecord, fposForPartner, partnerWarning, docLinesAmounts, lineTaxIds, mapTaxesWithFpos, getProductRecordMemoized, getTaxRecord, computeTaxAmounts, todayISO } from "./rules_helpers.js";

/* ================================================================== */
/* Helpers internes au domaine Ventes                                  */
/* ================================================================== */

/**
 * Lit la société courante du document et retourne { company, currency }
 * (devise = company.currency_id, normalisée).
 */
async function getCompanyCurrency(values, helpers) {
  const companyId = m2oId(values.company_id);
  let company = null;
  if (companyId) {
    try {
      company = await helpers.getRecordSmart("res.company", companyId, helpers.apiKey, helpers.baseUrl);
    } catch (err) {
      company = null;
    }
  }
  const cur = asM2o(company && company.currency_id);
  return { company, currency: cur && cur.id ? cur : false };
}

/** Devise d'une pricelist (pricelist.currency_id), repli devise société. */
async function currencyForPricelist(pricelistId, values, helpers) {
  if (pricelistId) {
    try {
      const pricelist = await helpers.getRecordSmart("product.pricelist", pricelistId, helpers.apiKey, helpers.baseUrl);
      const cur = asM2o(pricelist && pricelist.currency_id);
      if (cur && cur.id) {
        const refs = await helpers.getReferenceRecordsSmart("res.currency", helpers.apiKey, helpers.baseUrl);
        return { id: cur.id, display_name: displayOf(refs, cur.id) || cur.display_name };
      }
    } catch (err) {
      /* pricelist non en cache — repli devise société */
    }
  }
  const { currency } = await getCompanyCurrency(values, helpers);
  if (currency && currency.id) {
    const refs = await helpers.getReferenceRecordsSmart("res.currency", helpers.apiKey, helpers.baseUrl);
    return { id: currency.id, display_name: displayOf(refs, currency.id) || currency.display_name };
  }
  return false;
}

/* ================================================================== */
/* sale.order — cascade partner (mirroir des @api.depends('partner_id'))*/
/* ================================================================== */

onchangeRegistry.add("sale.order:partner_id", async (partnerId, values, helpers) => {
  if (!partnerId || typeof partnerId === "string") return null; // id local tmp:… ou vide

  let partner = null;
  try {
    partner = await helpers.getRecordSmart("res.partner", partnerId, helpers.apiKey, helpers.baseUrl);
  } catch (err) {
    return null; // pas en cache — aucune donnée fiable à appliquer
  }
  if (isMissingRecord(partner)) return null; // sentinel "non disponible" : ne rien écraser

  const patch = {};

  // _compute_partner_invoice_id / _compute_partner_shipping_id —
  // approximation documentée : address_get() est serveur, on repique le
  // partner lui-même (côté serveur, le contact adresse prendra le relais
  // à la prochaine consultation en ligne).
  patch.partner_invoice_id = { id: partnerId, display_name: partner.display_name || partner.name || "" };
  patch.partner_shipping_id = { id: partnerId, display_name: partner.display_name || partner.name || "" };

  // _compute_payment_term_id : partner.property_payment_term_id
  const term = asM2o(partner.property_payment_term_id);
  if (term && term.id) {
    const refs = await helpers.getReferenceRecordsSmart("account.payment.term", helpers.apiKey, helpers.baseUrl);
    patch.payment_term_id = { id: term.id, display_name: displayOf(refs, term.id) || term.display_name };
  } else {
    patch.payment_term_id = false;
  }

  // _compute_pricelist_id : partner.property_product_pricelist (draft only)
  if (!values.state || values.state === "draft" || values.state === "sent") {
    const pricelist = asM2o(partner.property_product_pricelist);
    if (pricelist && pricelist.id) {
      const refs = await helpers.getReferenceRecordsSmart("product.pricelist", helpers.apiKey, helpers.baseUrl);
      patch.pricelist_id = { id: pricelist.id, display_name: displayOf(refs, pricelist.id) || pricelist.display_name };
    } else {
      patch.pricelist_id = false;
    }
  }

  // _compute_currency_id : pricelist.currency_id or company.currency_id
  const pricelistId = m2oId(patch.pricelist_id) || m2oId(partner.property_product_pricelist);
  if (pricelistId) {
    const cur = await currencyForPricelist(pricelistId, values, helpers);
    if (cur && cur.id) patch.currency_id = cur;
  }

  // _compute_fiscal_position_id (approximation par pays du partner)
  const fpos = await fposForPartner(partner, helpers);
  patch.fiscal_position_id = fpos && fpos.id ? fpos : false;

  // _compute_user_id : partner.user_id or commercial_partner.user_id
  // (l'utilisateur de la maison mère si le contact n'en a pas)
  let user = asM2o(partner.user_id);
  if ((!user || !user.id) && m2oId(partner.commercial_partner_id)) {
    try {
      const commercial = await helpers.getRecordSmart(
        "res.partner", m2oId(partner.commercial_partner_id), helpers.apiKey, helpers.baseUrl
      );
      user = isMissingRecord(commercial) ? false : asM2o(commercial.user_id);
    } catch (err) {
      user = false;
    }
  }
  if (user && user.id) {
    const refs = await helpers.getReferenceRecordsSmart("res.users", helpers.apiKey, helpers.baseUrl);
    patch.user_id = { id: user.id, display_name: displayOf(refs, user.id) || user.display_name };
  }

  // _compute_note : conditions générales de la société
  // (base sale : company.invoice_terms si l'ICP account.use_invoice_terms est
  // actif — ICP non lisible offline, on applique si non vide, repli sûr).
  const { company } = await getCompanyCurrency(values, helpers);
  const terms = company && (company.invoice_terms || company.invoice_terms_html);
  if (terms) patch.note = terms;

  return patch;
});

/* ================================================================== */
/* sale.order — onchanges simples                                      */
/* ================================================================== */

// _compute_currency_id relancé par le changement de pricelist
onchangeRegistry.add("sale.order:pricelist_id", async (pricelistId, values, helpers) => {
  const cur = await currencyForPricelist(pricelistId, values, helpers);
  if (!cur || !cur.id) return null;
  return { currency_id: cur };
});

// _onchange_prepayment_percent : si vide → require_payment = False
onchangeRegistry.add("sale.order:prepayment_percent", (percent) => {
  if (!percent) return { require_payment: false };
  return null;
});

// _onchange_company_id_warning : warning si des lignes existent (draft)
onchangeRegistry.add("sale.order:company_id", (companyId, values) => {
  if (!companyId) return null;
  const hasLines = Array.isArray(values.order_line) && values.order_line.length > 0;
  if (hasLines && (!values.state || values.state === "draft")) {
    return {
      _warning: {
        title: "Warning for the change of your quotation's company",
        message:
          "Changing the company of an existing quotation might need some manual adjustments " +
          "in the details of the lines. You might consider updating the prices.",
      },
    };
  }
  return null;
});

// _onchange_commitment_date : warning si la date promise < date attendue.
// expected_date est un compute non stocké : indisponible sur un record
// jamais vu en ligne ; la règle ne se déclenche que s'il est présent.
onchangeRegistry.add("sale.order:commitment_date", (commitmentDate, values) => {
  if (commitmentDate && values.expected_date && commitmentDate < values.expected_date) {
    return {
      _warning: {
        title: "Requested date is too soon.",
        message:
          "The delivery date is sooner than the expected date. " +
          "You may be unable to honor the delivery date.",
      },
    };
  }
  return null;
});

// _onchange_partner_id_warning : partner.sale_warn (block → reset du champ)
onchangeRegistry.add("sale.order:partner_id#partner_warn", async (partnerId, values, helpers) => {
  if (!partnerId || typeof partnerId === "string") return null;
  let partner = null;
  try {
    partner = await helpers.getRecordSmart("res.partner", partnerId, helpers.apiKey, helpers.baseUrl);
  } catch (err) {
    return null;
  }
  const warning = await partnerWarning(partner, "sale_warn", helpers);
  if (!warning) return null;
  if (warning.block) {
    return { partner_id: false, _warning: { title: warning.title, message: warning.message, block: true } };
  }
  return { _warning: warning };
});

/* ================================================================== */
/* sale.order — computes de champ (offline_field_compute)              */
/* ================================================================== */

// _compute_amounts : somme des lignes AVEC taxes.
// La vue standard ne rend PAS de colonnes price_tax / price_total :
// on résout donc la taxe de chaque ligne via le moteur offline
// (record account.tax en cache, repli sur la price_tax serveur de la
// ligne initiale quand le record est introuvable hors-ligne).
const SALE_LINES = "order_line";
const SALE_QTY = "product_uom_qty";
fieldComputeRegistry.add("sale.order:amount_total", async (values, helpers, containerEl) =>
  (await docLinesAmounts(values, containerEl, SALE_LINES, SALE_QTY, helpers)).total
);
fieldComputeRegistry.add("sale.order:amount_tax", async (values, helpers, containerEl) =>
  (await docLinesAmounts(values, containerEl, SALE_LINES, SALE_QTY, helpers)).tax
);
fieldComputeRegistry.add("sale.order:amount_untaxed", async (values, helpers, containerEl) =>
  (await docLinesAmounts(values, containerEl, SALE_LINES, SALE_QTY, helpers)).untaxed
);

// _compute_is_expired : draft/sent et validity_date < aujourd'hui
fieldComputeRegistry.add("sale.order:is_expired", (values) => {
  if (!values.state || !["draft", "sent"].includes(values.state)) return false;
  if (!values.validity_date) return false;
  return String(values.validity_date).slice(0, 10) < todayISO();
});

/* ================================================================== */
/* sale.order — contrainte locale (mirroir du @api.constrains)         */
/* ================================================================== */

constraintsRegistry.add("sale.order", (values) => {
  if (values.commitment_date && values.date_order && values.commitment_date < values.date_order) {
    return "La date d'engagement ne peut pas être antérieure à la date de commande.";
  }
  if (values.require_payment && values.prepayment_percent && !(0 < Number(values.prepayment_percent) <= 1)) {
    return "Le pourcentage d'acompte doit être un pourcentage valide (entre 0 et 100 %).";
  }
  return null;
});

/* ================================================================== */
/* sale.order + sale_management — validité & signature                 */
/* ================================================================== */
// NB : l'ancienne règle d'exemple "sale.order:partner_id#payment_term"
// (sale_order_rules.js) est absorbée par la règle principale
// "sale.order:partner_id" ci-dessus — ne plus la réenregistrer
// (double écriture de payment_term_id).

async function computeValidityDate(_changedValue, values, { getRecordSmart, apiKey, baseUrl }) {
  if (values.sale_order_template_id) {
    const template = await getRecordSmart("sale.order.template", values.sale_order_template_id, apiKey, baseUrl);
    if (template?.number_of_days > 0) {
      const target = new Date();
      target.setDate(target.getDate() + template.number_of_days);
      return { validity_date: target.toISOString().slice(0, 10) };
    }
  }

  if (values.company_id) {
    const company = await getRecordSmart("res.company", m2oId(values.company_id), apiKey, baseUrl);
    if (company?.quotation_validity_days > 0) {
      const target = new Date();
      target.setDate(target.getDate() + company.quotation_validity_days);
      return { validity_date: target.toISOString().slice(0, 10) };
    }
  }

  return { validity_date: null };
}

onchangeRegistry.add("sale.order:sale_order_template_id#validity_date", computeValidityDate);
onchangeRegistry.add("sale.order:company_id#validity_date", computeValidityDate);

/**
 * Équivalent de _compute_require_signature (sale + sale_management) :
 * 1. Si sale_order_template_id défini -> require_signature = template.require_signature
 * 2. Sinon -> require_signature = company_id.portal_confirmation_sign
 */
async function computeRequireSignature(_changedValue, values, { getRecordSmart, apiKey, baseUrl }) {
  if (values.sale_order_template_id) {
    const template = await getRecordSmart("sale.order.template", values.sale_order_template_id, apiKey, baseUrl);
    if (!isMissingRecord(template)) {
      return { require_signature: !!template.require_signature };
    }
  }

  if (values.company_id) {
    const company = await getRecordSmart("res.company", m2oId(values.company_id), apiKey, baseUrl);
    if (!isMissingRecord(company)) {
      return { require_signature: !!company.portal_confirmation_sign };
    }
  }

  return null;
}

onchangeRegistry.add("sale.order:sale_order_template_id#require_signature", computeRequireSignature);
onchangeRegistry.add("sale.order:company_id#require_signature", computeRequireSignature);

// _compute_require_payment : company.portal_confirmation_pay
onchangeRegistry.add("sale.order:company_id#require_payment", async (_changedValue, values, helpers) => {
  const companyId = m2oId(values.company_id);
  if (!companyId) return null;
  try {
    const company = await helpers.getRecordSmart("res.company", companyId, helpers.apiKey, helpers.baseUrl);
    if (isMissingRecord(company)) return null;
    return { require_payment: !!company?.portal_confirmation_pay };
  } catch (err) {
    return null;
  }
});

/* ================================================================== */
/* sale.order.line — onchange produit (backfill de ligne)              */
/* ================================================================== */

// _compute_name / _compute_product_uom / _compute_tax_id /
// _compute_price_unit / _compute_amount — portés en "backfill" : pour
// chaque ligne ayant un produit mais des champs dérivés vides, on les
// remplit depuis le record produit en cache. Idempotent : une ligne déjà
// complète n'est jamais retouchée (le prix saisi à la main est conservé,
// comme le conditionne _compute_price_unit côté serveur via qty_invoiced).
onchangeRegistry.add("sale.order:order_line#product", async (lines, values, helpers) => {
  if (!Array.isArray(lines)) return null;

  let refsUom = null;
  let changed = false;
  const filled = [];

  // Vide = undefined/false/null/""/tableau vide — un prix volontairement
  // 0 est conservé. Une colonne ABSENTE de la vue (pas dans `line`) ne
  // doit JAMAIS rendre la ligne « incomplète » : sinon la règle
  // resterait active à chaque événement et refetcherait les produits en
  // boucle.
  const isEmpty = (v) =>
    Array.isArray(v) ? v.length === 0 : v === undefined || v === false || v === null || v === "";
  const num = (v) => (v === undefined || v === false || v === null ? 0 : Number(v) || 0);
  const sameMoney = (a, b) => num(a).toFixed(2) === num(b).toFixed(2);

  for (const line of lines) {
    if (!line) { filled.push(line); continue; }
    const pid = line.product_id;
    if (!pid || typeof pid === "string") { filled.push(line); continue; } // id local tmp:…

    // Backfill des champs dérivés. La colonne taxe n'est PAS dans cette
    // liste : elle a son propre fill dédié ci-dessous (miroir de
    // _compute_tax_id, qui ne se déclenche que lors du choix du
    // produit) — une colonne taxe vide ne doit pas non plus empêcher la
    // règle de se stabiliser (boucle de refetch).
    const needsFill =
      ("name" in line && isEmpty(line.name)) ||
      ("price_unit" in line && isEmpty(line.price_unit)) ||
      ("product_uom" in line && isEmpty(line.product_uom));

    // Lecture produit : cache d'abord, un fetch, mémo d'échec 5 min.
    let product = null;
    if (needsFill) {
      product = await getProductRecordMemoized(pid, helpers);
      if (!product) { filled.push(line); continue; }
    }

    const updated = { ...line };
    if (needsFill && product) {
      if (!updated.name) updated.name = product.description_sale || product.name || "";

      const uom = asM2o(product.uom_id);
      if (uom && uom.id && !line.product_uom) {
        if (!refsUom) refsUom = await helpers.getReferenceRecordsSmart("product.uom", helpers.apiKey, helpers.baseUrl);
        updated.product_uom = { id: uom.id, display_name: displayOf(refsUom, uom.id) || uom.display_name };
      }

      if ("price_unit" in updated && isEmpty(line.price_unit)) {
        // pas de pricelist offline → repli list_price
        updated.price_unit = Number(product.list_price) || 0;
      }
    }

    // ---- Fill DÉDIÉ des taxes (sale.order.line._compute_tax_id, v17) ----
    // UNIQUEMENT sur les lignes nouvelles (sans id) : tax_id est un
    // MANY2MANY — TOUTES les taxes du produit, MAPPÉES par la position
    // fiscale du document (fpos.map_tax). C'est ce mapping qui explique
    // p. ex. « produit taxé 3 % → ligne 15 % » quand le client a une
    // position fiscale. Une ligne SERVEUR avec colonne taxe vide est
    // laissée telle quelle (parité Odoo : le compute ne se relance que
    // lors du choix du produit).
    const isNewLine = line.id === undefined || line.id === null || line.id === false;
    const taxCols = ["tax_id", "taxes_id", "tax_ids"].filter((f) => f in line);
    if (isNewLine && taxCols.length && taxCols.some((f) => isEmpty(line[f]))) {
      let p = product;
      if (!p) p = await getProductRecordMemoized(pid, helpers);
      if (p && Array.isArray(p.taxes_id) && p.taxes_id.length) {
        const mapped = await mapTaxesWithFpos(p.taxes_id, values.fiscal_position_id, helpers);
        if (mapped.length) {
          for (const f of taxCols) if (isEmpty(line[f])) updated[f] = mapped;
        }
      }
    }

    // ---- _compute_amount + taxes (toujours recalculé, idempotent) ----
    const qty = num(updated.product_uom_qty);
    const price = num(updated.price_unit);
    const discount = num(updated.discount);
    const subtotal = Number((qty * price * (1 - discount / 100)).toFixed(2));

    // taxes de la ligne : TOUTES les colonnes taxes rendues par la vue
    // (tax_id m2o unique v17, taxes_id / tax_ids additionnelles).
    // Quatre cas :
    //  - id(s) connu(s) + record(s) lisible(s) → calcul du moteur
    //    approximatif (prix TTC : le total reste le sous-total, comme Odoo) ;
    //  - id(s) déclaré(s) mais record(s) non en cache (offline) → INCONNUE :
    //    price_tax serveur conservée, ajoutée au total ;
    //  - colonne taxe présente mais vide → 0 ;
    //  - aucune colonne taxe dans la vue → valeur serveur conservée.
    let taxAmount;
    const hasTaxCol = ["tax_id", "taxes_id", "tax_ids"].some((f) => f in line || f in updated);
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
        // taxe(s) déclarée(s) mais pas en cache (offline) → valeur serveur
        taxAmount = num(line.price_tax);
        updated.price_total = Number((subtotal + taxAmount).toFixed(2));
      }
    } else if (hasTaxCol) {
      taxAmount = 0;
      updated.price_tax = 0;
      updated.price_total = subtotal;
    } else {
      // aucune colonne taxe rendue : valeur serveur conservée
      taxAmount = num(line.price_tax);
      updated.price_total = Number((subtotal + taxAmount).toFixed(2));
    }
    updated.price_subtotal = subtotal;

    // Idempotence : si les montants ne changent pas et qu'il n'y a rien à
    // remplir, on renvoie la ligne telle quelle (aucun écrit DOM, aucune
    // cascade, aucun refetch de produit). Un montant ABSENT de la vue
    // (colonne non rendue → non collectée) ne doit pas casser
    // l'idempotence : on ne compare que les clés présentes dans la
    // ligne collectée.
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

  return changed ? { order_line: filled } : null;
});
