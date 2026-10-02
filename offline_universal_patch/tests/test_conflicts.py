# -*- coding: utf-8 -*-
import uuid

from odoo.tests import TransactionCase, tagged

from ..services.device_service import get_device
from ..services.operation_service import OperationService


@tagged("post_install", "-at_install")
class TestOfflineConflicts(TransactionCase):
    def test_stale_write_date_is_reported_as_conflict(self):
        partner = self.env["res.partner"].create({"name": "Offline conflict source"})
        partner.write({"name": "Changed online"})
        device = get_device(self.env, str(uuid.uuid4()), create=True)
        operation = {
            "operation_uuid": str(uuid.uuid4()),
            "model": "res.partner",
            "method": "write",
            "args": [[partner.id], {"name": "Offline edit"}],
            "kwargs": {},
            "expected_write_dates": {str(partner.id): "2000-01-01 00:00:00"},
        }
        result = OperationService.execute_one(self.env, device, operation)
        self.assertEqual(result["status"], "conflict")
        self.assertEqual(partner.name, "Changed online")
