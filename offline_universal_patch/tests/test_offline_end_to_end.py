# -*- coding: utf-8 -*-
import uuid

from odoo.tests import TransactionCase, tagged

from ..services.change_capture_service import ChangeCaptureService
from ..services.device_service import get_device
from ..services.snapshot_service import SnapshotService
from ..services.operation_service import OperationService


@tagged("post_install", "-at_install")
class TestOfflineServerFlow(TransactionCase):
    def test_snapshot_operation_and_delta_flow(self):
        partner = self.env["res.partner"].create({"name": "Offline flow before"})
        snapshot = SnapshotService.read_one(self.env, "res.partner", partner.id)
        self.assertEqual(snapshot["id"], partner.id)
        cursor = self.env["offline.universal.change"].sudo().search([], order="id desc", limit=1).id
        device = get_device(self.env, str(uuid.uuid4()), create=True)
        operation = {
            "operation_uuid": str(uuid.uuid4()),
            "model": "res.partner",
            "method": "write",
            "args": [[partner.id], {"name": "Offline flow after"}],
            "kwargs": {},
            "expected_write_dates": {str(partner.id): snapshot.get("write_date")},
        }
        applied = OperationService.execute_one(self.env, device, operation)
        self.assertEqual(applied["status"], "done")
        changes = ChangeCaptureService.pull(self.env, cursor=cursor, limit=50)
        self.assertTrue(any(
            change["model"] == "res.partner" and change["id"] == partner.id and change["operation"] == "upsert"
            for change in changes["changes"]
        ))
