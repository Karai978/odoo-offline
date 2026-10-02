# -*- coding: utf-8 -*-
from odoo import http
from odoo.http import request

from ..services.change_capture_service import ChangeCaptureService
from ..services.device_service import get_device


class OfflineUniversalChangesController(http.Controller):
    @http.route(
        "/offline_universal_patch/changes",
        type="json",
        auth="user",
        methods=["POST"],
        csrf=False,
    )
    def changes(self, device_uuid=None, cursor=0, limit=200):
        device = get_device(request.env, device_uuid, create=False)
        result = ChangeCaptureService.pull(request.env, cursor=cursor, limit=limit)
        device.sudo().write({"last_change_id": result["cursor"]})
        return result
