# -*- coding: utf-8 -*-
from odoo import fields, models


class OfflineUniversalReceipt(models.Model):
    _name = "offline.universal.receipt"
    _description = "Offline Universal Operation Receipt"
    _order = "id desc"

    operation_uuid = fields.Char(required=True, index=True, copy=False)
    user_id = fields.Many2one("res.users", required=True, index=True, ondelete="cascade")
    device_id = fields.Many2one("offline.universal.device", index=True, ondelete="set null")
    payload_hash = fields.Char(required=True, index=True)
    model_name = fields.Char(index=True)
    method_name = fields.Char()
    state = fields.Selection(
        [("done", "Done"), ("conflict", "Conflict")],
        required=True,
        default="done",
        index=True,
    )
    result_json = fields.Json()

    _sql_constraints = [
        (
            "offline_universal_receipt_user_uuid_unique",
            "unique(user_id, operation_uuid)",
            "An operation UUID can only be applied once by a user.",
        ),
    ]
