/**
 * views/list/stock_picking_dashboard.js
 * Construit le domaine additionnel pour les clics sur les compteurs
 * du kanban "Opérations" (stock.picking.type), en miroir des méthodes
 * Python get_action_picking_tree_* de addons/stock.
 */
export function buildStockPickingTypeDomain(methodName) {
  const today = new Date().toISOString().slice(0, 19).replace("T", " ");
  switch (methodName) {
    case "get_action_picking_tree_ready":
      return [["state", "=", "assigned"]];
    case "get_action_picking_tree_waiting":
      return [["state", "in", ["confirmed", "waiting"]]];
    case "get_action_picking_tree_late":
      return [["scheduled_date", "<", today], ["state", "not in", ["done", "cancel"]]];
    case "get_action_picking_tree_backorder":
      return [["backorder_id", "!=", false], ["state", "not in", ["done", "cancel"]]];
    case "get_stock_picking_action_picking_type":
      return []; // "Tous" -- aucun filtre d'état
    default:
      return null; // méthode non gérée -> on laisse le comportement par défaut (form)
  }
}