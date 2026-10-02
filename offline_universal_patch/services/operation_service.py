# -*- coding: utf-8 -*-
import hashlib
import json

from odoo.api import call_kw
from odoo.exceptions import AccessError, ValidationError
from odoo.service.model import get_public_method

from .conflict_service import ConflictService
from .security_service import is_snapshotable_model, json_safe

MUTATING_METHODS = {"create", "write", "unlink", "web_save", "action_archive", "action_unarchive", "resequence"}


def _stable_hash(payload):
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _remap_local_ids(value, id_map):
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, int):
        return id_map.get(str(value), value)
    if isinstance(value, list):
        return [_remap_local_ids(item, id_map) for item in value]
    if isinstance(value, tuple):
        return tuple(_remap_local_ids(item, id_map) for item in value)
    if isinstance(value, dict):
        return {key: _remap_local_ids(item, id_map) for key, item in value.items()}
    return value


def _created_ids(result):
    if isinstance(result, int) and not isinstance(result, bool):
        return [result]
    if isinstance(result, (list, tuple)):
        return [
            item if isinstance(item, int) and not isinstance(item, bool)
            else item.get("id") if isinstance(item, dict) and item.get("id")
            else False
            for item in result
        ]
    if isinstance(result, dict) and result.get("id"):
        return [result["id"]]
    return []


class OperationService:
    @staticmethod
    def execute_batch(env, device, operations):
        if not isinstance(operations, list):
            raise ValidationError("Operations must be a list.")
        if len(operations) > 100:
            raise ValidationError("A batch may contain at most 100 operations.")
        results = []
        for operation in operations:
            try:
                with env.cr.savepoint():
                    results.append(OperationService.execute_one(env, device, operation))
            except Exception as error:
                operation_uuid = operation.get("operation_uuid") if isinstance(operation, dict) else None
                results.append({
                    "operation_uuid": operation_uuid,
                    "status": "error",
                    "error": str(error),
                })
        return results

    @staticmethod
    def execute_one(env, device, operation):
        if not isinstance(operation, dict):
            raise ValidationError("Invalid operation payload.")
        operation_uuid = str(operation.get("operation_uuid") or "")
        model_name = operation.get("model")
        method_name = operation.get("method")
        if not operation_uuid or len(operation_uuid) > 128:
            raise ValidationError("An operation UUID is required.")
        if not is_snapshotable_model(env, model_name):
            raise AccessError("Unknown or protected model in operation.")
        if not isinstance(method_name, str) or not method_name or method_name.startswith("_"):
            raise AccessError("The requested method is not allowed.")

        args = operation.get("args", [])
        kwargs = operation.get("kwargs", {})
        expected_write_dates = operation.get("expected_write_dates") or {}
        local_id = operation.get("local_id")
        raw_local_ids = operation.get("local_ids")
        local_ids = list(raw_local_ids) if raw_local_ids is not None else ([local_id] if local_id is not None else [])
        if any(not isinstance(value, int) or isinstance(value, bool) for value in local_ids):
            raise ValidationError("Local identifiers must be integers.")
        if not isinstance(args, (list, tuple)) or not isinstance(kwargs, dict):
            raise ValidationError("Invalid method arguments.")
        if not isinstance(expected_write_dates, dict):
            raise ValidationError("Invalid expected write-date map.")

        # Version expectations and temporary IDs are synchronization metadata,
        # not part of the business method payload. Keeping them out of this hash
        # lets a timed-out online call be replayed from the local outbox safely.
        payload_hash = _stable_hash({
            "model": model_name,
            "method": method_name,
            "args": args,
            "kwargs": kwargs,
        })
        env.cr.execute(
            "SELECT pg_advisory_xact_lock(hashtext(%s))",
            ["offline-universal:%s:%s" % (env.uid, operation_uuid)],
        )
        Receipt = env["offline.universal.receipt"].sudo()
        receipt = Receipt.search(
            [("user_id", "=", env.uid), ("operation_uuid", "=", operation_uuid)],
            limit=1,
        )
        if receipt:
            if receipt.payload_hash != payload_hash:
                raise ValidationError("An operation UUID was reused with a different payload.")
            current_map = dict(device.id_map or {})
            replayed_mappings = []
            if receipt.state == "done" and local_ids and method_name in ("create", "web_save"):
                receipt_server_ids = _created_ids(receipt.result_json)
                if len(local_ids) == len(receipt_server_ids):
                    for local, server in zip(local_ids, receipt_server_ids):
                        if server:
                            current_map[str(local)] = int(server)
                            replayed_mappings.append({"local_id": local, "server_id": int(server)})
                    if replayed_mappings:
                        device.sudo().write({"id_map": current_map})
            if not replayed_mappings:
                replayed_mappings = [
                    {"local_id": local, "server_id": int(current_map[str(local)])}
                    for local in local_ids
                    if str(local) in current_map
                ]
            return {
                "operation_uuid": operation_uuid,
                "status": receipt.state,
                "result": receipt.result_json,
                "replayed": True,
                "local_ids": local_ids,
                "mapped_ids": replayed_mappings,
                "id_map": current_map,
            }

        id_map = dict(device.id_map or {})
        args = _remap_local_ids(args, id_map)
        kwargs = _remap_local_ids(kwargs, id_map)
        mapped_expected = {
            str(id_map.get(str(record_id), record_id)): write_date
            for record_id, write_date in expected_write_dates.items()
        }
        model = env[model_name]

        conflicts = []
        if method_name in MUTATING_METHODS or expected_write_dates:
            conflicts = ConflictService.check_write_dates(
                env, model_name, method_name, args, mapped_expected
            )
        if conflicts:
            result = {"conflicts": conflicts}
            Receipt.create({
                "operation_uuid": operation_uuid,
                "user_id": env.uid,
                "device_id": device.id,
                "payload_hash": payload_hash,
                "model_name": model_name,
                "method_name": method_name,
                "state": "conflict",
                "result_json": json_safe(result),
            })
            return {"operation_uuid": operation_uuid, "status": "conflict", "result": result}

        context = dict(kwargs.get("context") or {})
        context.update({
            "offline_universal_operation": operation_uuid,
            "offline_universal_device": device.device_uuid,
        })
        kwargs["context"] = context
        if method_name == "resequence":
            ids = args[0] if args else []
            field_name = kwargs.get("field", "sequence")
            offset = int(kwargs.get("offset", 0) or 0)
            if field_name not in model._fields:
                result = False
            else:
                sequence_model = model.with_context(**context)
                for index, record in enumerate(sequence_model.browse(ids).exists()):
                    record.write({field_name: index + offset})
                result = True
        else:
            get_public_method(model, method_name)
            result = call_kw(model, method_name, list(args), kwargs)
        safe_result = json_safe(result)

        server_ids = _created_ids(safe_result) if method_name in ("create", "web_save") else []
        mapped_ids = []
        if local_ids and server_ids:
            if len(local_ids) != len(server_ids):
                raise ValidationError("The server returned an unexpected number of created records.")
            for local, server in zip(local_ids, server_ids):
                if server:
                    id_map[str(local)] = int(server)
                    mapped_ids.append({"local_id": local, "server_id": int(server)})
            if mapped_ids:
                device.sudo().write({"id_map": id_map})
        server_id = server_ids[0] if server_ids else False

        Receipt.create({
            "operation_uuid": operation_uuid,
            "user_id": env.uid,
            "device_id": device.id,
            "payload_hash": payload_hash,
            "model_name": model_name,
            "method_name": method_name,
            "state": "done",
            "result_json": safe_result,
        })
        return {
            "operation_uuid": operation_uuid,
            "status": "done",
            "result": safe_result,
            "local_id": local_id,
            "server_id": server_id or False,
            "local_ids": local_ids,
            "server_ids": [item for item in server_ids if item],
            "mapped_ids": mapped_ids,
            "id_map": id_map,
        }
