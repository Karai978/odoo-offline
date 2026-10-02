# -*- coding: utf-8 -*-
from odoo.exceptions import AccessError

from .snapshot_service import SnapshotService

DEFAULT_CHANGE_LIMIT = 200
MAX_CHANGE_LIMIT = 500


class ChangeCaptureService:
    @staticmethod
    def pull(env, cursor=0, limit=DEFAULT_CHANGE_LIMIT):
        try:
            cursor = max(0, int(cursor))
            limit = min(MAX_CHANGE_LIMIT, max(1, int(limit)))
        except (TypeError, ValueError):
            cursor, limit = 0, DEFAULT_CHANGE_LIMIT

        Change = env["offline.universal.change"].sudo()
        rows = Change.search([("id", ">", cursor)], order="id asc", limit=limit)
        changes = []
        purged_models = set()
        new_cursor = cursor
        for row in rows:
            new_cursor = row.id
            model_name = row.model_name
            if model_name.startswith("offline.universal."):
                continue
            if model_name not in env.registry.models:
                if model_name not in purged_models:
                    changes.append({"cursor": row.id, "model": model_name, "operation": "purge_model"})
                    purged_models.add(model_name)
                continue
            try:
                env[model_name].check_access_rights("read")
            except AccessError:
                if model_name not in purged_models:
                    changes.append({"cursor": row.id, "model": model_name, "operation": "purge_model"})
                    purged_models.add(model_name)
                continue
            try:
                if row.operation == "delete":
                    changes.append({"cursor": row.id, "model": model_name, "id": row.record_id, "operation": "delete"})
                    continue
                record = env[model_name].with_context(active_test=False).browse(row.record_id).exists()
                if not record:
                    changes.append({"cursor": row.id, "model": model_name, "id": row.record_id, "operation": "delete"})
                    continue
                data = SnapshotService.read_one(env, model_name, row.record_id, include_binary=False)
                if data is None:
                    changes.append({"cursor": row.id, "model": model_name, "id": row.record_id, "operation": "delete"})
                else:
                    changes.append({
                        "cursor": row.id,
                        "model": model_name,
                        "id": row.record_id,
                        "operation": "upsert",
                        "record": data,
                    })
            except AccessError:
                # Do not disclose fields after record-rule access has been revoked.
                changes.append({"cursor": row.id, "model": model_name, "id": row.record_id, "operation": "delete"})

        return {"changes": changes, "cursor": new_cursor, "has_more": bool(rows) and len(rows) == limit}
