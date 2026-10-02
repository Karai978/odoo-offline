# -*- coding: utf-8 -*-
from odoo import api, models


class BaseOfflineChangeCapture(models.AbstractModel):
    """Capture ORM mutations without editing individual business addons.

    This deliberately records identifiers, not field values. Values are read
    later through the requesting user's environment so record rules remain in
    force. Raw SQL and external database writers cannot be observed here.
    """

    _inherit = "base"

    def _offline_universal_should_capture(self):
        if self.env.context.get("offline_universal_skip_capture"):
            return False
        if self._name.startswith("offline.universal."):
            return False
        if getattr(self, "_transient", False):
            return False
        return bool(self.ids)

    def _offline_universal_capture(self, ids, operation):
        if not ids or not self._offline_universal_should_capture():
            return
        actor_id = self.env.uid
        company_id = self.env.company.id if self.env.company else False
        rows = [
            {
                "model_name": self._name,
                "record_id": record_id,
                "operation": operation,
                "actor_id": actor_id,
                "company_id": company_id,
            }
            for record_id in ids
        ]
        self.env["offline.universal.change"].sudo().with_context(
            offline_universal_skip_capture=True
        ).create(rows)

    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        records._offline_universal_capture(records.ids, "upsert")
        return records

    def write(self, vals):
        ids = list(self.ids)
        result = super().write(vals)
        self._offline_universal_capture(ids, "upsert")
        return result

    def unlink(self):
        ids = list(self.ids)
        should_capture = self._offline_universal_should_capture()
        model_name = self._name
        env = self.env
        result = super().unlink()
        # `self` is empty after unlink; use the original environment/model name.
        if ids and should_capture:
            rows = [
                {
                    "model_name": model_name,
                    "record_id": record_id,
                    "operation": "delete",
                    "actor_id": env.uid,
                    "company_id": env.company.id if env.company else False,
                }
                for record_id in ids
            ]
            env["offline.universal.change"].sudo().with_context(
                offline_universal_skip_capture=True
            ).create(rows)
        return result
