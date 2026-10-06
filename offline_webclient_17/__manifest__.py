{
    "name": "Offline Webclient 17",
    "version": "17.0.1.0.0",
    "summary": "Offline read cache for the native Odoo 17 WebClient",
    "category": "Technical",
    "license": "LGPL-3",
    "depends": ["web"],
    "assets": {
        "web.assets_backend": [
            "offline_webclient_17/static/src/offline_call_cache.js",
            "offline_webclient_17/static/src/offline_status_service.js",
            "offline_webclient_17/static/src/offline_orm_patch.js",
            "offline_webclient_17/static/src/offline_status_systray.js",
            "offline_webclient_17/static/src/offline_status_systray.xml",
            "offline_webclient_17/static/src/offline_status.scss",
        ],
    },
    "installable": True,
    "application": False,
}
