/** @odoo-module **/

import { makeOfflineActionCompatible } from "../src/services/offline_action";

QUnit.module("offline_universal_patch.offline_action");

QUnit.test("keeps cached native views and removes unsupported pivot and graph modes", (assert) => {
    const action = {
        res_model: "sale.order",
        view_mode: "pivot,graph,list,form",
        views: [[false, "pivot"], [false, "graph"], [false, "list"], [false, "form"]],
        context: { group_by: ["date_order:month"], search_default_confirmed: 1 },
    };
    const nativeViews = {
        views: { list: { id: false }, form: { id: false }, search: { id: false } },
    };

    const result = makeOfflineActionCompatible(action, nativeViews);
    assert.deepEqual(result.views, [[false, "list"], [false, "form"]]);
    assert.strictEqual(result.view_mode, "list,form");
    assert.notOk("group_by" in result.context);
    assert.strictEqual(result.context.search_default_confirmed, 1);
});

QUnit.test("falls back to a cached list and clears unsupported pivot grouping", (assert) => {
    const action = {
        res_model: "sale.order",
        view_mode: "pivot,graph",
        views: [[false, "pivot"], [false, "graph"]],
        context: { group_by: ["date_order:month"], search_default_confirmed: 1 },
        search_view_id: [99, "Custom Search"],
    };
    const nativeViews = {
        views: { list: { id: false }, search: { id: 5 } },
    };

    const result = makeOfflineActionCompatible(action, nativeViews);
    assert.deepEqual(result.views, [[false, "list"]]);
    assert.strictEqual(result.view_mode, "list");
    assert.notOk("group_by" in result.context);
    assert.strictEqual(result.context.search_default_confirmed, 1);
    assert.strictEqual(result.search_view_id, false);
});
