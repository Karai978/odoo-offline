/**
 * model/rules_engine/rules/sale_order.js
 * =========================================
 * Miroir de purchase_order.js pour sale.order(.line) -- même logique
 * métier, mais le champ de quantité s'appelle "product_uom_qty" côté
 * vente (au lieu de "product_qty" côté achat).
 *
 * Déplacé depuis les mêmes fichiers que purchase_order.js (voir ce
 * fichier pour le détail), le générique x2many_field.js gérant les deux
 * modèles avec la même fonction avant cette extraction.
 */

export const saleOrderLineRules = [
  {
    model: "sale.order.line",
    method: "_onchange_product_id",
    trigger: { fields: ["product_id"] },
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
    model: "sale.order.line",
    method: "_compute_amount",
    computes: ["price_subtotal", "price_total"],
    trigger: { fields: ["product_uom_qty", "price_unit"] },
    compute(line) {
      const qty = Number(line.product_uom_qty) || 0;
      const priceUnit = Number(line.price_unit) || 0;
      const subtotal = qty * priceUnit;
      return {
        price_subtotal: Number(subtotal.toFixed(2)),
        price_total: Number(subtotal.toFixed(2)),
      };
    },
  },
];

export const saleOrderRules = [
  {
    model: "sale.order",
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
