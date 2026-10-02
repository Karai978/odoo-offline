/** @odoo-module **/

import { ORM } from "@web/core/orm_service";
import { patch } from "@web/core/utils/patch";

import { getOfflineRuntime } from "../services/runtime";

patch(ORM.prototype, {
    call(model, method, args = [], kwargs = {}) {
        const runtime = getOfflineRuntime();
        if (!runtime || !runtime.isOffline()) {
            return super.call(model, method, args, kwargs);
        }
        const fullContext = Object.assign({}, this.user.context, kwargs.context || {});
        const params = {
            model,
            method,
            args,
            kwargs: Object.assign({}, kwargs, { context: fullContext }),
        };
        const route = `/web/dataset/call_kw/${encodeURIComponent(model)}/${encodeURIComponent(method)}`;
        return runtime.handleOfflineRpc(route, params);
    },
});
