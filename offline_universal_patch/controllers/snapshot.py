# -*- coding: utf-8 -*-
from odoo import http
from odoo.http import request

from ..services.snapshot_service import SnapshotService


class OfflineUniversalSnapshotController(http.Controller):
    @http.route(
        "/offline_universal_patch/snapshot",
        type="json",
        auth="user",
        methods=["POST"],
        csrf=False,
    )
    def snapshot(self, model=None, offset=0, limit=200, include_binary=False):
        if not model:
            return {"error": "A model name is required."}
        return SnapshotService.page(
            request.env,
            model,
            offset=offset,
            limit=limit,
            include_binary=bool(include_binary),
        )
