# -*- coding: utf-8 -*-
from odoo import fields, models


class OfflineUniversalDevice(models.Model):
    _name = "offline.universal.device"
    _description = "Offline Universal Device"
    _order = "last_seen desc, id desc"

    name = fields.Char(required=True, default="Offline browser")
    user_id = fields.Many2one(
        "res.users", required=True, index=True, default=lambda self: self.env.uid,
        ondelete="cascade",
    )
    device_uuid = fields.Char(required=True, index=True, copy=False)
    last_seen = fields.Datetime(required=True, default=fields.Datetime.now)
    last_change_id = fields.Integer(default=0, index=True)
    id_map = fields.Json(default=dict)
    active = fields.Boolean(default=True)

    _sql_constraints = [
        (
            "offline_universal_user_device_unique",
            "unique(user_id, device_uuid)",
            "An offline device must be unique per user.",
        ),
    ]
