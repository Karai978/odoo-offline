# -*- coding: utf-8 -*-
from odoo.exceptions import AccessError, UserError

from .security_service import FIELD_ATTRIBUTES, is_snapshotable_model, json_safe


DEFAULT_PAGE_SIZE = 200
MAX_PAGE_SIZE = 500


def _snapshot_field_names(model, include_binary):
    fields_info = model.fields_get(attributes=FIELD_ATTRIBUTES)
    field_names = []
    for name in fields_info:
        field = model._fields.get(name)
        if not field or not field.store:
            # Non-stored computed fields may execute arbitrary server-side code
            # (and access models the current user cannot read) on every read.
            # They cannot be faithfully snapshotted as static offline values.
            continue
        if field.type == "binary" and not include_binary:
            continue
        field_names.append(name)
    if "id" not in field_names:
        field_names.insert(0, "id")
    return field_names


class SnapshotService:
    @staticmethod
    def page(env, model_name, offset=0, limit=DEFAULT_PAGE_SIZE, include_binary=False):
        if not is_snapshotable_model(env, model_name):
            raise AccessError("The requested model is not available for offline snapshotting.")
        model = env[model_name].with_context(active_test=False)
        model.check_access_rights("read")

        try:
            offset = max(0, int(offset))
            limit = min(MAX_PAGE_SIZE, max(1, int(limit)))
        except (TypeError, ValueError):
            raise UserError("Invalid snapshot page parameters.")

        field_names = _snapshot_field_names(model, include_binary)

        total = model.search_count([])
        records = model.search([], offset=offset, limit=limit, order="id asc")
        values = records.read(field_names, load=None)
        next_offset = offset + len(values)
        return {
            "model": model_name,
            "offset": offset,
            "limit": limit,
            "total": total,
            "records": json_safe(values),
            "next_offset": next_offset if next_offset < total else None,
            "done": next_offset >= total,
            "binary_included": bool(include_binary),
        }

    @staticmethod
    def read_one(env, model_name, record_id, include_binary=False):
        if not is_snapshotable_model(env, model_name):
            raise AccessError("The requested model is not available for offline snapshotting.")
        model = env[model_name].with_context(active_test=False)
        model.check_access_rights("read")
        record = model.browse(int(record_id)).exists()
        if not record:
            return None
        fields_to_read = _snapshot_field_names(model, include_binary)
        return json_safe(record.read(fields_to_read, load=None)[0])
