/** @odoo-module **/

import { hasCompleteTaxTotals } from "../src/patches/tax_totals_guard";

QUnit.module("offline_universal_patch.tax_totals_guard");

QUnit.test("accepts a complete server-computed tax totals structure", (assert) => {
    const totals = {
        amount_untaxed: 100,
        subtotals_order: ["Untaxed Amount"],
        groups_by_subtotal: {
            "Untaxed Amount": [{ tax_group_amount: 20, tax_group_base_amount: 100 }],
        },
    };
    assert.true(hasCompleteTaxTotals(totals));
});

QUnit.test("rejects missing or incomplete tax totals instead of displaying a local zero", (assert) => {
    assert.false(hasCompleteTaxTotals(undefined));
    assert.false(hasCompleteTaxTotals({}));
    assert.false(hasCompleteTaxTotals({
        amount_untaxed: 0,
        subtotals_order: ["Untaxed Amount"],
        groups_by_subtotal: {},
    }));
    assert.false(hasCompleteTaxTotals({
        amount_untaxed: 0,
        subtotals_order: ["Untaxed Amount"],
        groups_by_subtotal: {
            "Untaxed Amount": [{ tax_group_amount: 20 }],
        },
    }));
});
