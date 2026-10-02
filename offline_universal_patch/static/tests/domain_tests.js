/** @odoo-module **/

import { domainMatches, sortRecords } from "../src/query/domain";

QUnit.module("offline_universal_patch.domain");

QUnit.test("evaluates common Odoo domain operators and implicit AND", (assert) => {
    const record = { name: "Antananarivo Office", active: true, amount: 12, partner_id: 7 };
    assert.true(domainMatches(record, [["active", "=", true], ["amount", ">=", 10]]));
    assert.true(domainMatches(record, ["|", ["name", "ilike", "office"], ["amount", "=", 0]]));
    assert.false(domainMatches(record, [["partner_id", "in", [2, 3]]]));
});

QUnit.test("sorts local rows using an Odoo order string", (assert) => {
    const rows = [{ id: 1, name: "B" }, { id: 2, name: "A" }];
    assert.deepEqual(sortRecords(rows, "name asc").map((row) => row.id), [2, 1]);
});
