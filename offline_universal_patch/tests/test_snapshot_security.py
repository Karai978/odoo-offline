# -*- coding: utf-8 -*-
from odoo.exceptions import AccessError
from odoo.tests import TransactionCase, tagged

from ..services.manifest_service import ManifestService
from ..services.snapshot_service import SnapshotService, _snapshot_field_names


class _FakeField:
    def __init__(self, field_type, store):
        self.type = field_type
        self.store = store


class _FakeModel:
    def __init__(self, model_name):
        self._name = model_name
        self._fields = {
            "id": _FakeField("integer", True),
            "tax_totals": _FakeField("binary", False),
            "unsafe_summary": _FakeField("float", False),
            "attachment": _FakeField("binary", True),
        }

    def fields_get(self, attributes=None):
        return {name: {} for name in self._fields}


@tagged("post_install", "-at_install")
class TestOfflineSnapshot(TransactionCase):
    def test_catalog_contains_only_readable_registered_models(self):
        catalog = ManifestService.catalog(self.env)
        names = {item["model"] for item in catalog["models"]}
        self.assertIn("res.partner", names)
        self.assertNotIn("offline.universal.change", names)

    def test_snapshot_is_paged_and_uses_current_user_environment(self):
        partners = self.env["res.partner"].create([
            {"name": "Offline Snapshot A"},
            {"name": "Offline Snapshot B"},
            {"name": "Offline Snapshot C"},
        ])
        page = SnapshotService.page(self.env, "res.partner", offset=0, limit=2)
        self.assertEqual(page["model"], "res.partner")
        self.assertLessEqual(len(page["records"]), 2)
        self.assertGreaterEqual(page["total"], len(partners))
        self.assertIn("id", page["records"][0])

    def test_snapshot_omits_nonstored_computed_fields(self):
        model = self.env["res.partner"]
        field_names = _snapshot_field_names(model, include_binary=True)
        self.assertIn("name", field_names)
        self.assertFalse(model._fields["display_name"].store)
        self.assertNotIn("display_name", field_names)

    def test_snapshot_allowlists_only_standard_financial_tax_totals(self):
        sale_order = _FakeModel("sale.order")
        fields = _snapshot_field_names(sale_order, include_binary=False)
        self.assertIn("tax_totals", fields)
        self.assertNotIn("unsafe_summary", fields)
        self.assertNotIn("attachment", fields)

        crm_team = _FakeModel("crm.team")
        self.assertNotIn("tax_totals", _snapshot_field_names(crm_team, include_binary=True))

    def test_snapshot_rejects_internal_models(self):
        with self.assertRaises(AccessError):
            SnapshotService.page(self.env, "offline.universal.change")
