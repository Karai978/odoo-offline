# -*- coding: utf-8 -*-
import uuid

from odoo.tests import TransactionCase, tagged

from ..services.device_service import get_device
from ..services.operation_service import OperationService


@tagged("post_install", "-at_install")
class TestOfflineSyncOperations(TransactionCase):
    def _device(self):
        return get_device(self.env, str(uuid.uuid4()), create=True)

    def test_create_operation_is_idempotent(self):
        device = self._device()
        operation_uuid = str(uuid.uuid4())
        name = "Offline idempotency %s" % operation_uuid
        operation = {
            "operation_uuid": operation_uuid,
            "model": "res.partner",
            "method": "create",
            "args": [[{"name": name}]],
            "kwargs": {},
            "local_id": -81001,
        }
        first = OperationService.execute_one(self.env, device, operation)
        second = OperationService.execute_one(self.env, device, operation)
        self.assertEqual(first["status"], "done")
        self.assertEqual(second["status"], "done")
        self.assertTrue(second.get("replayed"))
        self.assertEqual(self.env["res.partner"].search_count([("name", "=", name)]), 1)

    def test_batch_rejects_unknown_internal_model(self):
        device = self._device()
        results = OperationService.execute_batch(self.env, device, [{
            "operation_uuid": str(uuid.uuid4()),
            "model": "offline.universal.change",
            "method": "unlink",
            "args": [[1]],
            "kwargs": {},
        }])
        self.assertEqual(results[0]["status"], "error")
