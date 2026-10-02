# -*- coding: utf-8 -*-
from odoo import http
from odoo.exceptions import UserError
from odoo.http import request
from odoo.addons.web.controllers.utils import clean_action

from ..services.device_service import get_device
from ..services.operation_service import OperationService


class OfflineUniversalOperationsController(http.Controller):
    @http.route(
        "/offline_universal_patch/operations",
        type="json",
        auth="user",
        methods=["POST"],
        csrf=False,
    )
    def operations(self, device_uuid=None, operations=None):
        device = get_device(request.env, device_uuid, create=False)
        results = OperationService.execute_batch(request.env, device, operations or [])
        return {"results": results, "id_map": device.id_map or {}}

    @http.route(
        "/offline_universal_patch/execute",
        type="json",
        auth="user",
        methods=["POST"],
        csrf=False,
    )
    def execute(self, device_uuid=None, operation=None, route_kind="call_kw"):
        """Idempotent online counterpart used for native client mutations."""
        device = get_device(request.env, device_uuid, create=True)
        operation = dict(operation or {})
        if route_kind == "resequence":
            operation["method"] = "resequence"
        # The HTTP request already owns the database transaction. Do not wrap
        # arbitrary public Odoo methods in a controller savepoint: some addons
        # manage transaction boundaries internally, which can invalidate an
        # outer savepoint before its context manager releases it.
        result = OperationService.execute_one(request.env, device, operation)
        if result.get("status") == "conflict":
            raise UserError("Conflit lors de l'application de cette opération offline.")
        if result.get("status") != "done":
            raise UserError("L'opération offline n'a pas pu être appliquée.")
        value = result.get("result")
        if route_kind == "button" and isinstance(value, dict) and value.get("type"):
            return clean_action(value, env=request.env)
        return value
