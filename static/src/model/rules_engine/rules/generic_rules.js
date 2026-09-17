/**
 * model/rules_engine/rules/generic_rules.js
 * ============================================
 * Règle de repli générique (model: "*"), utilisée quand un one2many
 * affiché n'a pas de champs price_subtotal/price_total couverts par une
 * règle spécifique (purchase.order.line, sale.order.line...).
 *
 * Déplacée depuis model/relational_model/compute_engine.js::computeLineSubtotal(),
 * qui réimplémentait qty*price une seconde fois pour ce cas de repli.
 *
 * Les noms de champs réels varient selon le modèle affiché (product_qty,
 * product_uom_qty, quantity...) et sont détectés dynamiquement côté
 * appelant (voir QTY_FIELD_CANDIDATES/PRICE_FIELD_CANDIDATES dans
 * compute_engine.js) -- cette règle travaille donc sur des clés
 * canoniques (__qty/__price), fournies par l'appelant, plutôt que sur des
 * noms de champs Odoo réels comme les autres règles.
 */

export const genericLineAmountRules = [
  {
    model: "*",
    method: "_compute_amount_generic",
    computes: ["__subtotal"],
    trigger: { fields: ["__qty", "__price"] },
    compute(line) {
      const qty = Number(line.__qty) || 0;
      const price = Number(line.__price) || 0;
      return { __subtotal: Number((qty * price).toFixed(2)) };
    },
  },
];
