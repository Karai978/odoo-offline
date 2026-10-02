# -*- coding: utf-8 -*-
import logging

from odoo import http
from odoo.http import request

from ..services.snapshot_service import SnapshotService

_logger = logging.getLogger(__name__)


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
        try:
            return SnapshotService.page(
                request.env,
                model,
                offset=offset,
                limit=limit,
                include_binary=bool(include_binary),
            )
        except Exception:
            _logger.exception(
                "Offline snapshot failed for model=%s offset=%s user_id=%s",
                model,
                offset,
                request.env.uid,
            )
            raise
