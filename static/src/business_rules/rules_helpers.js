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

/** Libellé d'un id dans une table de référence (name_service), "" si absent. */
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
