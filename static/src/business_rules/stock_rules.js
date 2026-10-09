/**
 * business_rules/stock_rules.js
 * ==============================
 * Règles métier "Inventaire complet" (stock.picking) pour le moteur
 * offline — équivalent JS explicite des @api.depends / @api.onchange /
 * garde-fous write() Python d'Odoo 17
 * (addons/stock/models/stock_picking.py), enregistrés dans les registres
 * business_rules_registry.js.
 *
 * Scope choisi : le picking (partie éditée offline par la PWA). Les lines
 * de stock.move ne sont PAS éditées offline — la propagation aux moves
 * (côté serveur à la synchro) n'est donc pas répliquée, ce qui est
 * documenté comme limite.
 *
 * Importé une seule fois au démarrage dans main.js (effet de bord).
 *
 * LIMITES OFFLINE DOCUMENTÉES (docs/odoo17-business-rules-digest.md) :
 *  - emplacements par défaut : picking_type.default_location_src/dest_id,
 *    sinon partner.property_stock_supplier / property_stock_customer,
 *    sinon l'EMPLACEMENT PAR DÉFAUT DU DÉPÔT (warehouse) n'est pas
 *    déductible offline (repli : le champ n'est pas touché) ;
 *  - state du picking (agrégat des moves) et forecast de disponibilité :
 *    non recalculés (données serveur).
 */

import {
  onchangeRegistry,
  fieldComputeRegistry,
} from "../model/relational_model/business_rules_registry.js";
import { asM2o, m2oId, displayOf, isMissingRecord, partnerWarning } from "./rules_helpers.js";

/* ================================================================== */
/* Résolution des emplacements (mémo de _compute_location_id)          */
/* ================================================================== */

/**
 * Mirroir offline de _compute_location_id :
 *   src  = picking_type.default_location_src_id  or partner.property_stock_supplier
 *   dest = picking_type.default_location_dest_id or partner.property_stock_customer
 * (le repli "emplacement du dépôt" est serveur : stock.warehouse.
 *  _get_partner_locations() — documenté comme limite.)
 *
 * @returns {Promise<{ location_id, location_dest_id, hasChange }>}
 */
async function resolveLocations(values, helpers) {
  let src = false;
  let dest = false;
  let refs = null;

  const locM2o = (rawId) => {
    if (!rawId) return false;
    const refs = refs;
    const display = refs ? displayOf(refs, rawId) : "";
    return { id: rawId, display_name: display };
  };

  const typeId = m2oId(values.picking_type_id);
  if (typeId) {
    try {
      const ptype = await helpers.getRecordSmart("stock.picking.type", typeId, helpers.apiKey, helpers.baseUrl);
      if (!isMissingRecord(ptype)) {
        src = asM2o(ptype.default_location_src_id);
        dest = asM2o(ptype.default_location_dest_id);
      }
    } catch (err) {
      /* picking type non en cache */
    }
  }

  const partnerId = m2oId(values.partner_id);
  if (( !src || !src.id) || (!dest || !dest.id)) {
    if (partnerId) {
      try {
        const partner = await helpers.getRecordSmart("res.partner", partnerId, helpers.apiKey, helpers.baseUrl);
        if (!isMissingRecord(partner)) {
          if (!src || !src.id) {
            const s = asM2o(partner.property_stock_supplier);
            if (s && s.id) src = s;
          }
          if (!dest || !dest.id) {
            const d = asM2o(partner.property_stock_customer);
            if (d && d.id) dest = d;
          }
        }
      } catch (err) {
        /* partner non en cache */
      }
    }
  }

  try {
    refs = await helpers.getReferenceRecordsSmart("stock.location", helpers.apiKey, helpers.baseUrl);
  } catch (err) {
    refs = [];
  }

  const locSrc = src && src.id ? locM2o(src.id) : false;
  const locDest = dest && dest.id ? locM2o(dest.id) : false;

  const hasChange =
    (locSrc && String(m2oId(values.location_id)) !== String(locSrc.id)) ||
    (locDest && String(m2oId(values.location_dest_id)) !== String(locDest.id));

  return { location_id: locSrc, location_dest_id: locDest, hasChange };
}

/* ================================================================== */
/* stock.picking — onchange picking_type_id / partner_id               */
/* ================================================================== */

async function onTypeOrPartnerChanged(_changed, values, helpers) {
  // Garde-fou write() : "Changing the operation type of this record is
  // forbidden at this point." (state != draft) — appliqué en warning local
  // (l'envoi restera bloqué côté serveur, mais l'utilisateur est averti).
  if (values.state && values.state !== "draft") {
    return {
      _warning: {
        title: "Changement de type d'opération interdit",
        message:
          "This transfer is not in draft state — changing the operation type " +
          "(or the partner) is forbidden at this point.",
        block: true,
      },
    };
  }

  const resolved = await resolveLocations(values, helpers);
  const patch = {};
  if (resolved.location_id && resolved.location_id.id) patch.location_id = resolved.location_id;
  if (resolved.location_dest_id && resolved.location_dest_id.id) patch.location_dest_id = resolved.location_dest_id;

  // picking_warn du partner (block → reset du partner), mirroir de
  // _onchange_picking_type côté serveur.
  const partnerId = m2oId(values.partner_id);
  if (partnerId) {
    let partner = null;
    try {
      partner = await helpers.getRecordSmart("res.partner", partnerId, helpers.apiKey, helpers.baseUrl);
    } catch (err) {
      partner = null;
    }
    if (isMissingRecord(partner)) partner = null;
    const warning = await partnerWarning(partner, "picking_warn", helpers);
    if (warning) {
      if (warning.block) {
        patch.partner_id = false;
        patch._warning = { title: warning.title, message: warning.message, block: true };
      } else {
        patch._warning = warning;
      }
    }
  }

  return Object.keys(patch).length ? patch : null;
}

onchangeRegistry.add("stock.picking:picking_type_id", onTypeOrPartnerChanged);
onchangeRegistry.add("stock.picking:partner_id", onTypeOrPartnerChanged);

/* ================================================================== */
/* stock.picking — onchange locations                                  */
/* ================================================================== */

// _onchange_locations : côté serveur, les emplacements sont propagés aux
// moves + warning si des operations ont déjà des quantités. Offline : pas
// d'édition des moves → on garde seulement l'information au warning.
async function onLocationsChanged(_changed, values, helpers) {
  const moves = values.move_ids_without_package || values.move_ids;
  if (Array.isArray(moves) && moves.some((m) => m && Number(m.quantity) > 0)) {
    return {
      _warning: {
        title: "Locations to update",
        message:
          "You might want to update the locations of this transfer's operations " +
          "(les lines de move seront alignées par le serveur à la synchronisation).",
      },
    };
  }
  return null;
}

onchangeRegistry.add("stock.picking:location_id", onLocationsChanged);
onchangeRegistry.add("stock.picking:location_dest_id", onLocationsChanged);

/* ================================================================== */
/* stock.picking — compute de champ                                    */
/* ================================================================== */

// _compute_date_deadline : min/max des deadlines des moves selon move_type
// (direct → min, sinon max). N'est appliqué que si les moves sont
// présents dans les valeurs (formulaire les incluant).
fieldComputeRegistry.add("stock.picking:date_deadline", (values) => {
  const moves = values.move_ids_without_package || values.move_ids;
  if (!Array.isArray(moves)) return undefined;
  const dates = moves
    .filter((m) => m && m.state && !["done", "cancel"].includes(m.state) && m.date_deadline)
    .map((m) => String(m.date_deadline).slice(0, 10));
  if (!dates.length) return undefined;
  dates.sort();
  return values.move_type === "direct" ? dates[0] : dates[dates.length - 1];
});