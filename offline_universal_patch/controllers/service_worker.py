# -*- coding: utf-8 -*-
from pathlib import Path

from odoo import http
from odoo.http import request


class OfflineUniversalServiceWorkerController(http.Controller):
    @http.route(
        "/offline_universal_patch/service_worker.js",
        type="http",
        auth="user",
        methods=["GET"],
        csrf=False,
        save_session=False,
    )
    def service_worker(self, **kwargs):
        worker_path = (
            Path(__file__).resolve().parents[1]
            / "static"
            / "src"
            / "service_worker"
            / "offline_service_worker.js"
        )
        body = worker_path.read_bytes()
        return request.make_response(
            body,
            headers=[
                ("Content-Type", "application/javascript; charset=utf-8"),
                # The worker script is served from an addon URL but controls /web.
                ("Service-Worker-Allowed", "/web"),
                ("Cache-Control", "no-cache, no-store, must-revalidate"),
                ("X-Content-Type-Options", "nosniff"),
            ],
        )
