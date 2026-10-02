# -*- coding: utf-8 -*-
from odoo.exceptions import AccessError
from odoo.tests import TransactionCase, tagged

from ..services.manifest_service import ManifestService
from ..services.snapshot_service import SnapshotService


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

    def test_snapshot_rejects_internal_models(self):
        with self.assertRaises(AccessError):
            SnapshotService.page(self.env, "offline.universal.change")
