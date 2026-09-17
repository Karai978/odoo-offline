/**
 * model/rules_engine/rules/purchase_order.js
 * ============================================
 * Règles compute/onchange pour purchase.order(.line) -- équivalent JS des
 * @api.onchange('product_id') et @api.depends('product_qty', 'price_unit')
 * du modèle Python purchase.order.line.
 *
 * Déplacé depuis :
 *  - views/fields/x2many/x2many_field.js::applyCatalogSelection()
 *    (le calcul name/price_unit/price_subtotal/price_total y était dupliqué
 *    deux fois : une pour les lignes existantes, une pour les nouvelles)
 *  - model/relational_model/compute_engine.js (recalcul du total qty*price,
 *    fait indépendamment en lisant le DOM)
 */

export const purchaseOrderLineRules = [
  {
    model: "purchase.order.line",
    method: "_onchange_product_id",
    trigger: { fields: ["product_id"] },
    // db : snapshot { get(model, id) } -- résolu par rules_engine à partir
    // du cache local product.product (ou fourni directement par
    // x2many_field.js à partir du catalogue déjà en mémoire).
    compute(line, db) {
      const product = db.get("product.product", line.product_id);
      if (!product) return null;
      return {
        name: product.display_name || product.name,
        price_unit: Number(product.price) || 0,
      };
    },
  },
  {
    model: "purchase.order.line",
    method: "_compute_amount",
    computes: ["price_subtotal", "price_total"],
    trigger: { fields: ["product_qty", "price_unit"] },
    compute(line) {
      const qty = Number(line.product_qty) || 0;
      const priceUnit = Number(line.price_unit) || 0;
      const subtotal = qty * priceUnit;
      // Pas de gestion des taxes côté offline pour l'instant (limitation
      // déjà présente dans le code d'origine) -- price_total = price_subtotal.
      return {
        price_subtotal: Number(subtotal.toFixed(2)),
        price_total: Number(subtotal.toFixed(2)),
      };
    },
  },
];

export const purchaseOrderRules = [
  {
    model: "purchase.order",
    method: "_compute_amount_total",
    computes: ["amount_total"],
    trigger: { fields: ["order_line.price_total"] },
    compute(order) {
      const lines = order.order_line || [];
      const total = lines.reduce((sum, l) => sum + (Number(l.price_total) || 0), 0);
      return { amount_total: Number(total.toFixed(2)) };
    },
  },
];
