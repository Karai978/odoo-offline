/** @odoo-module **/

import { registry } from "@web/core/registry";
import { patch } from "@web/core/utils/patch";

const FIELD_KEY = "account-tax-totals-field";
const PATCH_MARK = Symbol("offlineUniversalTaxTotalsGuard");
const fieldsRegistry = registry.category("fields");

export function hasCompleteTaxTotals(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    if (!Number.isFinite(value.amount_untaxed) || !Array.isArray(value.subtotals_order)) return false;
    const groupsBySubtotal = value.groups_by_subtotal;
    if (!groupsBySubtotal || typeof groupsBySubtotal !== "object" || Array.isArray(groupsBySubtotal)) return false;
    if (Object.values(groupsBySubtotal).some((groups) => !Array.isArray(groups))) return false;
    for (const subtotal of value.subtotals_order) {
        const groups = groupsBySubtotal[subtotal];
        if (!Array.isArray(groups)) return false;
        if (groups.some((group) =>
            !group || typeof group !== "object" ||
            !Number.isFinite(group.tax_group_amount) ||
            !Number.isFinite(group.tax_group_base_amount)
        )) return false;
    }
    return true;
}

function patchTaxTotalsField() {
    const field = fieldsRegistry.get(FIELD_KEY, null);
    const prototype = field?.component?.prototype;
    if (!prototype || typeof prototype.formatData !== "function" || prototype[PATCH_MARK]) return;

    Object.defineProperty(prototype, PATCH_MARK, { value: true });
    patch(prototype, {
        formatData(props) {
            const totals = props?.record?.data?.[props.name];
            if (!hasCompleteTaxTotals(totals)) {
                // The native template treats an empty object as truthy and then
                // iterates subtotals_order. Hide the widget rather than display
                // invented zeroes or malformed/stale tax amounts.
                this.totals = null;
                return;
            }
            return super.formatData(...arguments);
        },
    });
}

patchTaxTotalsField();
fieldsRegistry.addEventListener("UPDATE", patchTaxTotalsField);
