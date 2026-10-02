# -*- coding: utf-8 -*-
from odoo.exceptions import AccessError


FIELD_ATTRIBUTES = [
    "type", "string", "help", "required", "readonly", "relation", "selection",
    "domain", "digits", "size", "store", "company_dependent", "groups",
    "change_default", "searchable", "sortable", "aggregator", "group_operator",
    "currency_field", "on_delete", "default_export_compatible", "depends",
]


def json_safe(value):
    """Convert Odoo values used in manifests/results to JSON-safe values."""
    from datetime import date, datetime
    from decimal import Decimal

    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, bytes):
        import base64
        return base64.b64encode(value).decode("ascii")
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [json_safe(item) for item in value]
    if hasattr(value, "_name") and hasattr(value, "ids"):
        return list(value.ids)
    return str(value)


def model_access(env, model_name):
    if model_name not in env.registry.models:
        return {"read": False, "create": False, "write": False, "unlink": False}
    model = env[model_name]
    access = {}
    for operation in ("read", "create", "write", "unlink"):
        try:
            access[operation] = bool(model.check_access_rights(operation, raise_exception=False))
        except (AccessError, KeyError, TypeError):
            access[operation] = False
    return access


def is_snapshotable_model(env, model_name):
    model_class = env.registry.models.get(model_name)
    return bool(
        model_class
        and not model_name.startswith("offline.universal.")
        and not getattr(model_class, "_abstract", False)
        and not getattr(model_class, "_transient", False)
    )


def accessible_model_names(env):
    names = []
    for model_name, model_class in sorted(env.registry.models.items()):
        if model_name.startswith("offline.universal."):
            continue
        if getattr(model_class, "_abstract", False) or getattr(model_class, "_transient", False):
            continue
        access = model_access(env, model_name)
        if access["read"]:
            names.append(model_name)
    return names


def get_fields_info(env, model_name):
    if model_name not in env.registry.models:
        raise AccessError("Unknown model.")
    model = env[model_name]
    model.check_access_rights("read")
    fields_info = model.fields_get(attributes=FIELD_ATTRIBUTES)
    return {
        name: json_safe(info)
        for name, info in fields_info.items()
    }
