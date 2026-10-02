# -*- coding: utf-8 -*-
from odoo import fields


class ConflictService:
    @staticmethod
    def check_write_dates(env, model_name, method_name, args, expected_write_dates=None):
        """Compare snapshot versions before replaying destructive writes.

        expected_write_dates is a mapping from server record id to the ISO/write_date
        string last seen by the client. If a model has no write_date field, the
        server's access and business rules remain authoritative and no version check
        can be made for it.
        """
        if not expected_write_dates or model_name not in env.registry.models:
            return []
        model = env[model_name]
        if "write_date" not in model._fields:
            return []

        record_ids = []
        if method_name != "create" and args:
            first = args[0]
            if isinstance(first, int):
                record_ids = [first]
            elif isinstance(first, (list, tuple)):
                record_ids = [record_id for record_id in first if isinstance(record_id, int) and not isinstance(record_id, bool)]
        if not record_ids:
            return []

        expected_map = {int(key): value for key, value in expected_write_dates.items()}
        records = model.browse(record_ids).exists()
        found_ids = set(records.ids)
        conflicts = []
        for record_id in record_ids:
            expected = expected_map.get(record_id)
            if expected is None:
                continue
            record = records.filtered(lambda rec: rec.id == record_id)
            if not record:
                conflicts.append({"id": record_id, "reason": "missing"})
                continue
            actual = fields.Datetime.to_string(record.write_date) if record.write_date else False
            if str(expected) != str(actual):
                conflicts.append({
                    "id": record_id,
                    "expected_write_date": expected,
                    "server_write_date": actual,
                })
        for missing_id in set(record_ids) - found_ids:
            if not any(item["id"] == missing_id for item in conflicts):
                conflicts.append({"id": missing_id, "reason": "missing"})
        return conflicts
