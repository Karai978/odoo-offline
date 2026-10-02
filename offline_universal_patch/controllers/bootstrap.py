# -*- coding: utf-8 -*-
from odoo import http
from odoo.http import request

from ..services.device_service import get_device
from ..services.manifest_service import ManifestService


class OfflineUniversalBootstrapController(http.Controller):
    @http.route(
        "/offline_universal_patch/bootstrap",
        type="json",
        auth="user",
        methods=["POST"],
        csrf=False,
    )
    def bootstrap(self, device_uuid=None):
        device = get_device(request.env, device_uuid, create=True)
        manifest = ManifestService.catalog(request.env)
        manifest["device_uuid"] = device.device_uuid
        manifest["device_cursor"] = device.last_change_id
        return manifest

    @http.route(
        "/offline_universal_patch/model_manifest",
        type="json",
        auth="user",
        methods=["POST"],
        csrf=False,
    )
    def model_manifest(self, model=None, action_id=None, views=None, context=None):
        if not model:
            return {"error": "A model name is required."}
        return ManifestService.model_manifest(
            request.env,
            model,
            action_id=action_id,
            view_specs=views,
            context=context,
        )
