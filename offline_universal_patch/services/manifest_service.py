# -*- coding: utf-8 -*-
from odoo.addons.web.controllers.utils import clean_action
from odoo.exceptions import AccessError

from .security_service import accessible_model_names, get_fields_info, is_snapshotable_model, json_safe, model_access


class ManifestService:
    @staticmethod
    def catalog(env):
        menus = {}
        try:
            menus = env["ir.ui.menu"].load_web_menus(env.context.get("debug", False))
        except (AccessError, KeyError, AttributeError):
            menus = {}

        action_refs = set()
        for menu in menus.values():
            action_model = menu.get("actionModel")
            action_id = menu.get("actionID")
            if action_model and action_id:
                action_refs.add((action_model, int(action_id)))
        actions = {}
        for action_model, action_id in sorted(action_refs):
            if action_model not in env.registry.models:
                continue
            try:
                action_record = env[action_model].sudo().browse(action_id).exists()
                if not action_record:
                    continue
                raw_action = action_record.read()[0]
                action = clean_action(raw_action, env=env)
                action["id"] = action_id
                action["model"] = action_model
                if action_model == "ir.actions.act_window":
                    action["res_model"] = raw_action.get("res_model")
                    action["views"] = json_safe(raw_action.get("views") or action.get("views") or [])
                    action["view_mode"] = raw_action.get("view_mode") or action.get("view_mode")
                    action["domain"] = json_safe(raw_action.get("domain") or action.get("domain") or [])
                    action["context"] = json_safe(raw_action.get("context") or action.get("context") or {})
                actions[str(action_id)] = json_safe(action)
            except (AccessError, KeyError, ValueError, TypeError):
                # A menu can reference an action from an optional addon that is
                # no longer installed or has a custom load implementation.
                continue

        names = set(accessible_model_names(env))
        IrModel = env["ir.model"].sudo()
        model_rows = IrModel.search([("model", "in", list(names))])
        names_by_model = {row.model: row.name for row in model_rows}
        models = [
            {
                "model": model_name,
                "name": names_by_model.get(model_name, model_name),
                "access": model_access(env, model_name),
            }
            for model_name in sorted(names)
        ]

        apps = []
        root = menus.get("root") or {}
        for menu_id in root.get("children", []):
            app_menu = menus.get(menu_id) or menus.get(str(menu_id))
            if not app_menu:
                continue
            app_id = str(app_menu.get("appID") or menu_id)
            action_ids = {
                str(menu.get("actionID"))
                for menu in menus.values()
                if str(menu.get("appID")) == app_id and menu.get("actionID")
            }
            app_models = sorted({
                actions[action_id].get("res_model")
                for action_id in action_ids
                if action_id in actions and actions[action_id].get("res_model") in names
            })
            apps.append({
                "id": app_id,
                "menu_id": menu_id,
                "name": app_menu.get("name") or app_id,
                "action_ids": sorted(action_ids),
                "model_names": app_models,
            })

        Change = env["offline.universal.change"].sudo()
        last_change = Change.search([], order="id desc", limit=1)
        user = env.user
        return {
            "schema_version": 1,
            "server_version": "17.0",
            "database": env.cr.dbname,
            "user": {
                "id": user.id,
                "name": user.display_name,
                "login": user.login,
                "lang": user.lang,
                "tz": user.tz,
                "company_id": user.company_id.id,
                "company_ids": user.company_ids.ids,
                "context": json_safe(dict(env.context)),
            },
            "models": models,
            "apps": apps,
            "menus": json_safe(menus),
            "actions": actions,
            "cursor": last_change.id if last_change else 0,
        }

    @staticmethod
    def model_manifest(env, model_name, action_id=None, view_specs=None, context=None):
        if not is_snapshotable_model(env, model_name):
            raise AccessError("The requested model is not available for offline snapshotting.")
        access = model_access(env, model_name)
        if not access["read"]:
            raise AccessError("You do not have read access to this model.")
        # View metadata must use the authenticated user's request context. Do not
        # let a manifest caller broaden company scope through arbitrary kwargs.
        safe_context = {"lang": env.context.get("lang") or env.user.lang}
        model = env[model_name].with_context(**safe_context)
        fields_info = get_fields_info(model.env, model_name)
        requested_views = view_specs or [(False, "list"), (False, "form"), (False, "kanban"), (False, "search")]
        normalized_views = []
        for view_id, view_type in requested_views:
            normalized_type = "list" if view_type == "tree" else view_type
            if normalized_type in ("list", "form", "kanban", "search"):
                normalized_views.append((view_id or False, normalized_type))
        options = {"toolbar": True, "load_filters": True}
        if action_id:
            options["action_id"] = int(action_id)
        native_views = model.get_views(normalized_views, options)
        views = {
            view_type: view
            for view_type, view in (native_views.get("views") or {}).items()
            if view_type in ("list", "form", "kanban", "search")
        }
        key = f"{model_name}::{action_id or 'default'}"
        return {
            "key": key,
            "model": model_name,
            "action_id": action_id or False,
            "access": access,
            "fields": fields_info,
            "active_field": getattr(model, "_active_name", "active"),
            "views": json_safe(views),
            # Keep the native response shape so the browser can answer Odoo's
            # get_views RPC after reload without compiling a second renderer.
            "native_views": json_safe(native_views),
        }
