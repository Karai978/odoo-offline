/**
 * views/view.js
 */

import { registry } from "../core/registry.js";
import { mountListController } from "./list/list_controller.js";
import { mountFormController } from "./form/form_controller.js";

/**
 * Main dispatcher: decides whether to render a list or a form
 * based on the presence or absence of an id/isNew in the parameters.
 */
async function mountView(container, params, env) {
  const { id, isNew, view } = params;
  const isFormMode = !!(id || isNew);

  if (isFormMode) {
    return mountFormController(container, params, env);
  }
  return mountListController(container, params, env);
}

// "list_view": direct access to the list view (without ID)
registry.category("actions").add("list_view", {
  mount(container, params, env) {
    return mountListController(container, params, env);
  },
});

// "form_view": direct access to the form view (with id or isNew)
registry.category("actions").add("form_view", {
  mount(container, params, env) {
    return mountFormController(container, params, env);
  },
});

// "ir.actions.act_window": native Odoo format, automatically dispatched
// by the ActionService if the tag received from the server is of this type (useful
// once home_menu.js starts returning actual Odoo action descriptors).
registry.category("actions").add("ir.actions.act_window", {
  mount(container, params, env) {
    return mountView(container, params, env);
  },
});

export { mountView };
