# -*- coding: utf-8 -*-
from odoo import fields, models


class OfflineUniversalChange(models.Model):
    _name = "offline.universal.change"
    _description = "Offline Universal Change Journal"
    _order = "id asc"

    model_name = fields.Char(required=True, index=True)
    record_id = fields.Integer(required=True, index=True)
    operation = fields.Selection(
        [("upsert", "Create or Update"), ("delete", "Delete")],
        required=True,
        index=True,
    )
    actor_id = fields.Many2one("res.users", index=True, ondelete="set null")
    company_id = fields.Many2one("res.company", index=True, ondelete="set null")
    changed_at = fields.Datetime(required=True, default=fields.Datetime.now, index=True)
