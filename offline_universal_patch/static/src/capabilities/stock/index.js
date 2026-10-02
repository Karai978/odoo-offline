/** @odoo-module **/

// Stock reservations, quants, lots, routes and tracking require explicit
// offline business rules; no generic method executor is safe for these flows.
export const STOCK_OFFLINE_CAPABILITIES = Object.freeze([]);
