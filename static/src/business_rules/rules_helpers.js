/**
 * business_rules/rules_helpers.js
 * ================================
 * Fonctions partagées par les fichiers de règles métier par domaine
 * (sale_rules.js, purchase_rules.js, stock_rules.js, account_rules.js).
 * Aucun enregistrement ici — uniquement des helpers purs/side-effect-free
 * consommés par les fonctions de règles.
 *
 * Toutes les lectures de cache sont DÉFENSIVES : le backend offline_sync ne
 * garantit pas la présence de chaque champ sur chaque record. En cas
 * d'absence, les helpers retournent un repli sûr (false / 0 / null) —
 * une règle ne doit JAMAIS faire planter le formulaire offline.
 */

/* ------------------------------------------------------------------ */
/* Normalisation many2one                                              */
/* ------------------------------------------------------------------ */

/**
 * Normalise une valeur many2one lue dans un record Odoo (format
 * read_record : [id, display_name]) ou un id brut vers la forme
 * consommée par le moteur JS : { id, display_name } | false.
 */
export function asM2o(value) {
  if (value === undefined || value === null || value === false) return false;
  if (Array.isArray(value)) {
    if (value.length === 0) return false;
    return { id: value[0], display_name: value[1] ?? String(value[0]) };
  }
  if (typeof value === "object" && value.id !== undefined) {
    return { id: value.id, display_name: value.display_name ?? String(value.id) };
  }
  return { id: value, display_name: "" };
}

/**
 * Extrait l'id d'une valeur many2one (peut être [id, name], {id,...} ou un
 * id brut) — retourne false si vide (convention Odoo).
 */
export function m2oId(value) {
  if (value === undefined || value === null || value === false) return false;
  if (Array.isArray(value)) return value.length ? value[0] : false;
  if (typeof value === "object") return value.id !== undefined ? value.id : false;
  return value;
}

import { getCachedRecord, fetchAndStoreRecord } from "../core/record_cache.js";

/**
 * Libellé d'un id dans une table de référence (name_service), "" si absent. */
export function displayOf(refs, id) {
  if (id === false || id === null || id === undefined) return "";
  const found = (refs || []).find((r) => String(r.id) === String(id));
  return found ? found.display_name : "";
}

/**
 * Détecte le SENTINEL retourné par getRecordSmart quand un enregistrement
 * est introuvable (hors-ligne sans cache) : { id, display_name:
 * "Non disponible hors-ligne" }. Un tel objet est "truthy" — sans ce
 * contrôle, une règle pourrait écraser des champs avec des valeurs
 * vides/zéro au lieu de ne rien faire.
 */
export function isMissingRecord(rec) {
  return !rec || rec.display_name === "Non disponible hors-ligne";
}

/* ------------------------------------------------------------------ */
/* Fiscal position — approximation offline                             */
/* ------------------------------------------------------------------ */

/**
 * Approximation offline de account.fiscal.position._get_fiscal_position():
 * parmi les positions en cache (reference_records), choisit celle dont le
 * pays correspond au pays du partner (les positions foreign_vat ont la
 * priorité, comme côté serveur). Retourne { id, display_name } | false.
 *
 * LIMITE DOCUMENTÉE : le vrai moteur vérifie aussi la société et la
 * liste des positions autorisées — non reproductible sans les données
 * complètes. En l'absence de cache utilisable → false (pas de position),
 * comportement acceptable pour l'usage offline (le serveur recalcule à
 * la synchro).
 */
export async function fposForPartner(partner, helpers) {
  if (!partner) return false;
  const partnerCountryId = m2oId(partner.country_id);
  if (!partnerCountryId) return false;

  let refs = [];
  try {
    refs = await helpers.getReferenceRecordsSmart("account.fiscal.position", helpers.apiKey, helpers.baseUrl);
  } catch (err) {
    return false;
  }
  if (!refs.length) return false;

  let fallback = false;
  for (const ref of refs) {
    try {
      const fpos = await helpers.getRecordSmart("account.fiscal.position", ref.id, helpers.apiKey, helpers.baseUrl);
      const fposCountryId = m2oId(fpos && fpos.country_id);
      if (fposCountryId && String(fposCountryId) === String(partnerCountryId)) {
        if (fpos.foreign_vat) return { id: ref.id, display_name: ref.display_name };
        if (!fallback) fallback = { id: ref.id, display_name: ref.display_name };
      }
    } catch (err) {
      /* record non en cache — on passe à la suivante */
    }
  }
  return fallback;
}

/* ------------------------------------------------------------------ */
/* Warnings de partner (pattern common à tous les domaines)            */
/* ------------------------------------------------------------------ */

/**
 * Mirroir du pattern `*_warn` d'Odoo (res.partner.sale_warn /
 * purchase_warn / invoice_warn / picking_warn) : si le contact n'a pas de
 * message, remonte au parent (commercial_partner / parent_id) ; "block" →
 * le champ est reset, sinon warning simple.
 *
 * @param {object} partner - record res.partner (déjà récupéré)
 * @param {string} warnField - "sale_warn" | "purchase_warn" | "invoice_warn" | "picking_warn"
 * @param {object} helpers
 * @returns {Promise<{ warning: {title, message}, block: boolean } | null>}
 */
export async function partnerWarning(partner, warnField, helpers) {
  if (!partner) return null;
  let p = partner;

  if (p[warnField] === "no-message" && m2oId(p.parent_id)) {
    try {
      const parent = await helpers.getRecordSmart("res.partner", m2oId(p.parent_id), helpers.apiKey, helpers.baseUrl);
      if (parent) p = parent;
    } catch (err) {
      /* parent non en cache — on garde le contact */
    }
  }

  const warn = p[warnField];
  if (!warn || warn === "no-message") return null;

  // Block si le parent est bloqué mais le contact non averti
  if (warn !== "block" && m2oId(p.parent_id)) {
    try {
      const parent = await helpers.getRecordSmart("res.partner", m2oId(p.parent_id), helpers.apiKey, helpers.baseUrl);
      if (parent && parent[warnField] === "block") p = parent;
    } catch (err) {
      /* ignore */
    }
  }

  return {
    title: `Warning for ${p.display_name || p.name || "partner"}`,
    message: p[`${warnField}_msg`] || "",
    block: p[warnField] === "block",
  };
}

/* ------------------------------------------------------------------ */
/* Agrégats de lignes one2many                                         */
/* ------------------------------------------------------------------ */

/**
 * Sous-total brut d'une ligne produit : price_subtotal s'il est présent
 * dans la valeur collectée, sinon calcul qty × prix × (1 − remise/100) —
 * nécessaire quand la colonne price_subtotal n'est pas rendue par la vue
 * (le formulaire ne collecte que les colonnes présentes dans le DOM).
 */
export function defaultLineSubtotal(line) {
  if (!line) return 0;
  const qty = Number(line.product_uom_qty) || Number(line.product_qty) || 0;
  const price = Number(line.price_unit) || 0;
  const disc = Number(line.discount) || 0;
  return Number((qty * price * (1 - disc / 100)).toFixed(2));
}

/**
 * Somme d'un champ numérique sur un tableau de lignes (les lignes
 * section/note — display_type — sont exclues, comme côté serveur).
 * `fallback` : fonction line -> nombre, appliquée quand la ligne n'a pas
 * le champ (ex: price_subtotal non rendu → recalcul depuis les cellules).
 */
export function sumLineField(lines, field, fallback) {
  if (!Array.isArray(lines)) return 0;
  return lines.reduce((sum, line) => {
    if (!line || line.display_type) return sum;
    const v = parseFloat(line[field]);
    if (!isNaN(v)) return sum + v;
    const f = fallback ? parseFloat(fallback(line)) : 0;
    return sum + (isNaN(f) ? 0 : f);
  }, 0);
}

/** Date ISO du jour (yyyy-mm-dd), dans le fuseau local du poste. */
export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/* Lecture produit avec mémo d'échec (anti-spam réseau)                */
/* ------------------------------------------------------------------ */

// Mémoire des échecs de lecture produit : "model:id" -> timestamp.
// Un produit INDISSONIBLE (record absent, 403, réseau coupé) ne doit
// pas provoquer un fetch à CHAQUE événement de la ligne (boucle de
// refetch) — l'échec est mémorisé 5 minutes, comme les références.
const _productFailMemo = new Map();
const PRODUCT_FAIL_TTL = 5 * 60 * 1000;

/**
 * Record produit complet : CACHE D'ABORD (zéro réseau), sinon un fetch
 * unique (mis en cache sur succès). Sur échec : mémo négatif 5 min
 * (null ensuite, sans réseau). Null si introuvable/indisponible — une
 * règle ne doit jamais planter à cause d'un produit absent.
 */
export async function getProductRecordMemoized(productId, helpers) {
  const id = m2oId(productId);
  if (!id) return null;
  try {
    const cached = await getCachedRecord("product.product", id);
    if (cached) return cached;
  } catch (err) {
    /* cache illisible — on tente le réseau */
  }
  const key = "product.product:" + String(id);
  const failAt = _productFailMemo.get(key);
  if (failAt && Date.now() - failAt < PRODUCT_FAIL_TTL) return null;
  if (!navigator.onLine) {
    _productFailMemo.set(key, Date.now());
    return null;
  }
  try {
    const rec = await fetchAndStoreRecord("product.product", id, helpers.apiKey, helpers.baseUrl);
    _productFailMemo.delete(key);
    return rec || null;
  } catch (err) {
    _productFailMemo.set(key, Date.now());
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Moteur de taxes approximatif (offline)                              */
/* ------------------------------------------------------------------ */

/**
 * Récupère un enregistrement account.tax : CACHE D'ABORD (zéro réseau),
 * puis un fetch unique en ligne (qui met le record en cache pour la
 * suite — pas de spam type product.uom). Null si introuvable.
 *
 * Un mémo "in-flight" par id évite les fetchs en double quand plusieurs
 * recalculs parallèles (pied de tableau + computes de totaux) demandent
 * la même taxe au même moment.
 */
const _taxInflight = new Map();
export async function getTaxRecord(taxId, helpers) {
  const id = m2oId(taxId);
  if (!id) return null;
  try {
    const cached = await getCachedRecord("account.tax", id);
    if (cached) return cached;
  } catch (err) {
    /* cache illisible — on tente le réseau */
  }
  if (!navigator.onLine) return null;
  const key = String(id);
  if (_taxInflight.has(key)) return _taxInflight.get(key);
  const pending = fetchAndStoreRecord("account.tax", id, helpers.apiKey, helpers.baseUrl)
    .then((rec) => rec || null)
    .catch(() => null) // pas en cache, hors-ligne ou backend indisponible
    .finally(() => _taxInflight.delete(key));
  _taxInflight.set(key, pending);
  return pending;
}

/**
 * Moteur de taxes APPROXIMATIF — mirroir simplifié de
 * account.tax._compute_tax (Odoo 17) :
 *  - `percent` (taux en % sur la base HT) : base × taux / 100 ;
 *  - `ad_dosem` (montant fixe par unité) : quantité × montant ;
 *  - `price_include` (prix TTC) : base HT ≈ base / (1 + taux/100),
 *    taxe = base − base HT (approximation du reverse_compute ;
 *    l'interaction multi-taxes incluses d'Odoo n'est pas répliquée).
 *
 * NON répliqué (documenté) : groupes de taxes, arrondis fiscaux par
 * taxe (base_round/tax_round), répartition de base, map_tax de la
 * position fiscale. L'arrondi final est à 2 décimales.
 *
 * @param {number} base - base brute (qty × prix × (1 − remise/100))
 * @param {number} quantity
 * @param {object[]} taxRecords - records account.tax
 * @returns {{ tax_amount: number, included: boolean }}
 */
export function computeTaxAmounts(base, quantity, taxRecords) {
  let taxAmount = 0;
  let included = false;
  for (const tax of taxRecords || []) {
    if (!tax) continue;
    const amount = Number(tax.amount) || 0;
    if (tax.price_include) included = true;
    if (tax.amount_type === "ad_dosem") {
      // montant fixe par unité
      const fixedTotal = (Number(quantity) || 0) * amount;
      taxAmount += tax.price_include ? Math.min(fixedTotal, base) : fixedTotal;
    } else {
      // percent (défaut)
      if (tax.price_include) {
        const denom = 1 + amount / 100;
        const ht = denom > 0 ? base / denom : 0;
        taxAmount += base - ht;
      } else {
        taxAmount += (base * amount) / 100;
      }
    }
  }
  return { tax_amount: Number(taxAmount.toFixed(2)), included };
}

/**
 * Total TTC d'une ligne : price_total s'il est collecté (valeur serveur
 * ou écrite par les règles), sinon sous-total + taxe (hypothèse : taxes
 * hors prix — c'est le cas courant).
 */
export function defaultLineTotal(line) {
  if (!line) return 0;
  const subtotal =
    line.price_subtotal !== undefined && line.price_subtotal !== false && line.price_subtotal !== ""
      ? parseFloat(line.price_subtotal)
      : defaultLineSubtotal(line);
  const tax = parseFloat(line.price_tax);
  return Number(
    ((isNaN(subtotal) ? 0 : subtotal) + (isNaN(tax) ? 0 : tax)).toFixed(2)
  );
}

/* ------------------------------------------------------------------ */
/* Totaux document avec taxes — lecture commune aux computes de champs */
/* et au pied de tableau (compute_engine)                              */
/* ------------------------------------------------------------------ */

/**
 * Ids des taxes d'une ligne, quel que soit le nom de colonne rendu par
 * la vue : tax_id (m2o unique — vente/achat v17), taxes_id (m2o unique
 * OU m2m), tax_ids (m2m — factures). Les valeurs collectées peuvent être
 * des ids bruts, des paires [id, name] ou des objets {id, ...}.
 */
export function lineTaxIds(line) {
  if (!line) return [];
  const ids = [];
  const push = (id) => {
    if (id === false || id === null || id === undefined) return;
    if (!ids.some((x) => String(x) === String(id))) ids.push(id);
  };
  const pushAll = (col) => {
    if (Array.isArray(col)) {
      // Many2many (tax_id est m2m en v17, tax_ids/taxes_id m2m) : TOUTES
      // les taxes de la colonne
      for (const t of col) push(Array.isArray(t) ? t[0] : t && typeof t === "object" ? t.id : t);
    } else {
      push(m2oId(col));
    }
  };
  pushAll(line.tax_ids);
  pushAll(line.tax_id);
  pushAll(line.taxes_id);
  return ids;
}

/**
 * Miroir offline de account.fiscal.position.map_tax (Odoo 17) :
 *  - sans position fiscale → taxes inchangées ;
 *  - sinon, chaque taxe est remplacée par sa `tax_dest_id` si la position
 *    déclare une correspondance active (`tax_src_id` = taxe, `tax_dest_active`
 *    non désactivé) ; une correspondance vers une dest vide SUPPRIME la
 *    taxe ; les taxes sans correspondance sont conservées.
 *
 * Les correspondances sont lues dans le record de la position
 * (one2many `tax_ids` — renvoyé par read_record). Position non lisible
 * (hors-ligne, jamais chargée) → taxes brutes conservées et le serveur
 * corrigera à la synchro (limitation documentée).
 *
 * @param {object[]} taxPairs - taxes brutes au format [[id, name], ...]
 * @param {number|object|false} fposId
 * @param {object} helpers
 * @returns {Promise<object[]>} taxes mappées [[id, name], ...]
 */
export async function mapTaxesWithFpos(taxPairs, fposId, helpers) {
  const taxes = (Array.isArray(taxPairs) ? taxPairs : []).filter(Boolean);
  const id = m2oId(fposId);
  if (!id || !taxes.length) return taxes;
  let fpos = null;
  try {
    fpos = await helpers.getRecordSmart("account.fiscal.position", id, helpers.apiKey, helpers.baseUrl);
  } catch (err) {
    fpos = null;
  }
  if (!fpos || isMissingRecord(fpos) || !Array.isArray(fpos.tax_ids) || !fpos.tax_ids.length) {
    return taxes; // mapping inconnu → taxes brutes (le serveur tranchera)
  }
  const map = {};
  for (const row of fpos.tax_ids) {
    const src = row && (row.tax_src_id !== undefined ? m2oId(row.tax_src_id) : false);
    const dest = row && (row.tax_dest_id !== undefined ? m2oId(row.tax_dest_id) : false);
    // correspondance retenue si active (tax_dest_id vide = « supprimer la
    // taxe » ; tax_dest_active désactivé = correspondance ignorée)
    if (src && (!dest || row.tax_dest_active)) map[String(src)] = dest || "";
  }
  const result = [];
  for (const t of taxes) {
    const tid = Array.isArray(t) ? t[0] : t && typeof t === "object" ? t.id : t;
    const tname = Array.isArray(t) ? (t[1] ?? "") : t && typeof t === "object" ? (t.display_name ?? "") : "";
    const key = String(tid);
    if (key in map) {
      if (map[key] !== "") result.push([map[key], tname]); // nom de la dest : résolu par les références du widget
      // correspondance vers le vide → taxe supprimée (comme côté serveur)
    } else {
      result.push([tid, tname]); // pas de correspondance → taxe conservée
    }
  }
  return result;
}

/** Sous-total d'une ligne depuis ses cellules : qty × prix × (1 − remise/100). */
export function lineSubtotalOf(line, qtyField) {
  if (!line) return 0;
  const qty = Number(line[qtyField]) || 0;
  const price = Number(line.price_unit) || 0;
  const disc = Number(line.discount) || 0;
  return Number((qty * price * (1 - disc / 100)).toFixed(2));
}

/**
 * Résout le montant de taxe d'une ligne — le point UNIQUE de décision :
 *  1. record(s) account.tax lisible(s) (cache d'abord, réseau ensuite)
 *     → calcul du moteur approximatif (HT / TTC / montant fixe) ;
 *  2. ids de taxes déclarés mais aucun record lisible (hors-ligne, jamais
 *     chargée) → la price_tax SERVEUR de la ligne initiale est conservée
 *     et mise à l'échelle du nouveau sous-total (exact pour les taxes en
 *     pourcentage ; approximation documentée sinon) ;
 *  3. aucune donnée → taxe 0.
 *
 * @param {Array} taxIds - ids des taxes de la ligne
 * @param {number} base - sous-total courant (après remise)
 * @param {number} quantity
 * @param {object|null} serverAmounts - { price_tax, price_subtotal } de la
 *   ligne TELLE QUE SERVIE (données initiales, même si non rendues en vue)
 * @returns {Promise<{tax: number, included: boolean, source: "engine"|"server"|"none"|"unknown">}}
 */
export async function resolveLineTax(taxIds, base, quantity, serverAmounts, helpers) {
  if (!Array.isArray(taxIds) || taxIds.length === 0) {
    return { tax: 0, included: false, source: "none" };
  }
  const records = [];
  for (const id of taxIds) {
    const rec = await getTaxRecord(id, helpers);
    if (rec) records.push(rec);
  }
  if (records.length) {
    const { tax_amount, included } = computeTaxAmounts(base, quantity, records);
    return { tax: tax_amount, included, source: "engine" };
  }
  const serverTax = serverAmounts ? Number(serverAmounts.price_tax) : NaN;
  if (isFinite(serverTax) && serverTax > 0) {
    const serverSub = Number(serverAmounts.price_subtotal) || 0;
    const factor = serverSub > 0 ? base / serverSub : 1;
    return { tax: Number((serverTax * factor).toFixed(2)), included: false, source: "server" };
  }
  return { tax: 0, included: false, source: "unknown" };
}

/**
 * Somme les lignes d'un document avec leurs taxes — alimente à la fois
 * les computes de champs (amount_total / amount_tax / amount_untaxed) et
 * le pied de tableau.
 *
 * @param {object[]} lines - lignes collectées (collectFormData, dans
 *   l'ordre des lignes du DOM, tombstones {id,_deleted} en fin de liste)
 * @param {object[]|null} serverRows - données complètes initiales des
 *   lignes (tr._serverData), MÊME ordre que les lignes non supprimées
 * @param {object} helpers
 * @param {string} qtyField - nom du champ quantité du modèle
 */
export async function sumLinesWithTax(lines, serverRows, helpers, qtyField) {
  let total = 0;
  let taxSum = 0;
  if (!Array.isArray(lines)) return { total: 0, tax: 0, untaxed: 0 };
  let serverIdx = 0;
  for (const line of lines) {
    if (!line || line._deleted) continue; // tombstone de suppression (pas de tr)
    const server = serverRows && serverIdx < serverRows.length ? serverRows[serverIdx] : null;
    serverIdx++;
    if (line.display_type) continue; // sections / notes (comme côté serveur)

    const collectedSub = parseFloat(line.price_subtotal);
    const subtotal =
      line.price_subtotal !== undefined && line.price_subtotal !== false && line.price_subtotal !== "" && !isNaN(collectedSub)
        ? Number(line.price_subtotal)
        : lineSubtotalOf(line, qtyField);
    const qty = Number(line[qtyField]) || 0;

    let tax = 0;
    let included = false;
    const taxIds = lineTaxIds(line);
    if (taxIds.length) {
      const res = await resolveLineTax(taxIds, subtotal, qty, server, helpers);
      tax = res.tax;
      included = res.included;
    } else {
      // pas de taxe déclarée : si la vue rend une colonne price_tax,
      // on suit sa valeur (les règles la mettent à 0 si la taxe est retirée)
      const collectedTax = parseFloat(line.price_tax);
      if (line.price_tax !== undefined && line.price_tax !== false && line.price_tax !== "" && !isNaN(collectedTax)) {
        tax = Number(line.price_tax);
      }
    }
    taxSum += tax;
    total += included ? subtotal : subtotal + tax;
  }
  return {
    total: Number(total.toFixed(2)),
    tax: Number(taxSum.toFixed(2)),
    untaxed: Number((total - taxSum).toFixed(2)),
  };
}

/**
 * Totaux d'un document depuis les valeurs du formulaire courant : trouve
 * le one2many de lignes par son nom de champ et croise les valeurs
 * collectées avec les données initiales des lignes (tr._serverData) pour
 * le repli "valeur serveur" hors-ligne.
 */
export async function docLinesAmounts(values, containerEl, linesField, qtyField, helpers) {
  const lines = values && Array.isArray(values[linesField]) ? values[linesField] : [];
  let serverRows = null;
  if (containerEl && typeof containerEl.querySelector === "function") {
    try {
      const wrapper = containerEl.querySelector(`[data-one2many="${linesField}"] [data-o2m-root="true"]`);
      const tbody = wrapper && typeof wrapper._getTbody === "function" ? wrapper._getTbody() : null;
      if (tbody) {
        serverRows = Array.from(tbody.querySelectorAll("tr"))
          .filter((tr) => tr._cellRefs)
          .map((tr) => tr._serverData || null);
      }
    } catch (err) {
      serverRows = null;
    }
  }
  return sumLinesWithTax(lines, serverRows, helpers, qtyField);
}
