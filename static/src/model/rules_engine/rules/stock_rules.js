/**
 * model/rules_engine/rules/stock_rules.js
 * ==========================================
 * Relations de calcul Achat/Vente <-> Stock, reproduisant le workflow
 * Odoo 17 : CONFIRMER un achat ou une vente ne modifie PAS le stock --
 * ça crée un stock.picking (déjà géré par le vrai backend Odoo ; cette
 * PWA se contente de queueMethodCall("button_confirm"), voir
 * form_controller.js). C'est la VALIDATION du bon de réception/livraison
 * (stock.picking::button_validate) qui :
 *  - modifie réellement le stock disponible (stock.quant.quantity)
 *  - met à jour qty_received (purchase.order.line) / qty_delivered
 *    (sale.order.line) sur la commande d'origine
 *
 * Cette règle ne fait qu'un CALCUL (fonction pure, comme le reste de
 * rules_engine) -- elle retourne une liste de deltas, jamais d'écriture
 * directe. L'écriture dans core/local_ledger.js est faite par
 * form_controller.js::onObjectButtonClick(), qui seul connaît le
 * local_uuid de l'action à associer (pour pouvoir purger le ledger une
 * fois la sync confirmée).
 *
 * Astuce de conception : pas besoin de distinguer "réception" vs
 * "livraison" explicitement -- une réception a location_dest_id interne
 * (le stock augmente là) et location_id externe (fournisseur, ignoré côté
 * quant) ; une livraison a location_id interne (le stock y diminue) et
 * location_dest_id externe (client, ignoré côté quant). Le même calcul
 * source/destination fonctionne pour les deux, comme dans le vrai Odoo.
 */

// "quantity" = Odoo 17, "qty_done" = versions antérieures.
const QTY_DONE_FIELD_CANDIDATES = ["quantity", "qty_done"];

function unwrapMany2one(value) {
  // Un many2one est représenté [id, "Libellé"] dans les données de
  // formulaire (même convention que partout ailleurs dans ce projet --
  // voir list_renderer_utils.js, py_utils.js, domain_rules.js).
  return Array.isArray(value) ? value[0] : value;
}

export const stockPickingRules = [
  {
    model: "stock.picking",
    type: "stock_effect",
    method: "button_validate",
    // documentGraph: { root: champs du picking, lines: { <field>: {model, rows} } }
    // -- voir form_serializer.js::buildDocumentGraph()
    compute(documentGraph) {
      const deltas = [];
      const picking = documentGraph.root || {};

      // Les lignes de mouvement peuvent être sous plusieurs noms de champ
      // selon la vue -- on cherche le one2many dont le MODÈLE est
      // stock.move, peu importe son nom exact dans l'arch XML.
      const moveLinesEntry = Object.values(documentGraph.lines || {}).find((l) => l.model === "stock.move");
      if (!moveLinesEntry) return deltas; // vue sans lignes de mouvement -- rien à calculer

      // Repli si la vue du picking n'affiche pas location_id/
      // location_dest_id au niveau racine (vue simplifiée) -- confirmé en
      // pratique : ces champs ne sont pas toujours des colonnes visibles.
      const pickingLocationDest = unwrapMany2one(picking.location_dest_id);
      const pickingLocationSrc = unwrapMany2one(picking.location_id);

      for (const move of moveLinesEntry.rows) {
        const qtyField = QTY_DONE_FIELD_CANDIDATES.find((f) => f in move);
        const qty = qtyField ? Number(move[qtyField]) || 0 : 0;
        if (!qty) continue;

        const productId = unwrapMany2one(move.product_id);

        // Chaque mouvement porte sa PROPRE source/destination (plus précis
        // que le picking racine, qui n'est qu'une valeur par défaut) --
        // confirmé par les données réelles observées en debug.
        const locationDest = unwrapMany2one(move.location_dest_id) || pickingLocationDest;
        const locationSrc = unwrapMany2one(move.location_id) || pickingLocationSrc;

        // Mouvement de stock physique (double entrée : + à destination, - à
        // la source), qui que soit le sens réception/livraison.
        if (productId && locationDest) {
          deltas.push({ model: "stock.quant", key: `${productId}:${locationDest}`, deltaField: "quantity", delta: qty });
        }
        if (productId && locationSrc) {
          deltas.push({ model: "stock.quant", key: `${productId}:${locationSrc}`, deltaField: "quantity", delta: -qty });
        }

        // Répercussion sur la ligne d'achat/vente d'origine, selon le
        // champ de lien présent sur le mouvement (ajoutés respectivement
        // par les modules purchase_stock / sale_stock dans Odoo).
        const purchaseLineId = unwrapMany2one(move.purchase_line_id);
        if (purchaseLineId) {
          deltas.push({ model: "purchase.order.line", key: String(purchaseLineId), deltaField: "qty_received", delta: qty });
        }
        const saleLineId = unwrapMany2one(move.sale_line_id);
        if (saleLineId) {
          deltas.push({ model: "sale.order.line", key: String(saleLineId), deltaField: "qty_delivered", delta: qty });
        }
      }

      return deltas;
    },

    // Effet OPTIMISTE local (pas un delta d'un AUTRE enregistrement comme
    // ci-dessus, mais l'état visuel du picking lui-même) -- state passe
    // "assigned"/"confirmed" -> "done", et chaque ligne est marquée
    // "picked", pour que l'écran reflète l'action tout de suite même
    // hors-ligne, en attendant la confirmation réelle du serveur.
    optimisticState() {
      return {
        root: { state: "done" },
        lineUpdates: { picked: true },
      };
    },
  },
];