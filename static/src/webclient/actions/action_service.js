/**
 * webclient/actions/action_service.js
 */

import { registry } from "../../core/registry.js";
import { router } from "../../core/browser/router_service.js";
import { bus } from "../../core/bus/bus_service.js";
import { getApiKey } from "../../core/browser/session.js";

const DEFAULT_ACTION_TAG = "home_menu";

/** Normalizes an action descriptor (string or object) into { tag, ...params }. */
function normalizeActionDescriptor(actionDescriptor) {
  if (typeof actionDescriptor === "string") {
    return { tag: actionDescriptor };
  }
  return { ...actionDescriptor };
}

export class ActionService {
  /** @param {HTMLElement} container the single element where all actions are mounted */
  constructor(container) {
    this.container = container;
    this.currentController = null; 
    this.stack = [];

    this._env = {
      bus,
      doAction: this.doAction.bind(this),
      goBack: this.goBack.bind(this),
    };

    // Browser back/forward button -> restore state without
    // pushing onto the history stack (otherwise, infinite loop).
    router.onStateChange((state) => this.restoreState(state)); 
  }

  /**
   * Main entry point, called for any navigation:
   *   doAction("home_menu")
   *   doAction({ tag: "list_view", model: "res.partner" })
   * Options:
   *   - replace: true      -> replaces the history entry instead of stacking a new one
   *   - clearStack: true   -> clears the breadcrumb stack (e.g., return to root menu)
   *   - fromPopState: true -> internal use only (see restoreState)
   */
  async doAction(actionDescriptor, options = {}) {
    const { tag, ...params } = normalizeActionDescriptor(actionDescriptor);

    // --- Authentication Guard ---
    if (tag !== "login" && !getApiKey()) {
      return this.doAction(
        { tag: "login", redirectTo: { tag, ...params } },
        { replace: true }
      );
    }

    const actionsRegistry = registry.category("actions");
    if (!actionsRegistry.contains(tag)) {
      console.error(`[ActionService] Aucune action enregistrée pour "${tag}".`);
      this._renderUnknownAction(tag);
      return;
    }

    const actionDef = actionsRegistry.get(tag);

    this._destroyCurrentController();

    if (!options.fromPopState) {
      if (options.clearStack) {
        this.stack = [];
      } else if (this.currentController) {
        this.stack.push({
          tag: this.currentController.tag,
          params: this.currentController.params,
        });
      }
      if (options.replace) {
        router.replaceState({ tag, ...params });
      } else {
        router.pushState({ tag, ...params });
      }
    }

    this.container.innerHTML = "";
    const result = await actionDef.mount(this.container, params, this._env);
    const destroy = typeof result === "function" ? result : result?.destroy;

    this.currentController = { tag, params, destroy };
    bus.trigger("action:changed", { tag, params });
  }

  /**
   * Rebuilds the current screen from a history state (browser
   * back/forward buttons, or deep link on initial
   * load — see main.js, which calls restoreState(router.current)).
   */
  async restoreState(state) {
    if (!state || !state.tag) {
      return this.doAction(DEFAULT_ACTION_TAG, { fromPopState: true, clearStack: true });
    }
    const { tag, ...params } = state;
    await this.doAction({ tag, ...params }, { fromPopState: true });
  }

  /**
   * Returns to the previous action in the local stack without going through
   * the browser history (useful for an in-interface "Back" button,
   * distinct from the browser's back button).
   */
  async goBack() {
    const previous = this.stack.pop();
    if (previous) {
      await this.doAction(previous.tag, { ...previous.params, replace: true });
    } else {
      await this.doAction(DEFAULT_ACTION_TAG, { replace: true, clearStack: true });
    }
  }

  _destroyCurrentController() {
    if (this.currentController?.destroy) {
      try {
        this.currentController.destroy();
      } catch (err) {
        console.warn("[ActionService] Erreur lors du démontage du contrôleur précédent :", err);
      }
    }
    this.currentController = null;
  }

  _renderUnknownAction(tag) {
    this.container.innerHTML = "";
    const el = document.createElement("div");
    el.className = "o_action_not_found p-4";
    el.textContent = `Action inconnue : "${tag}"`;
    this.container.appendChild(el);
  }
}

/** Creates the singleton instance of ActionService for the given container. */
export function createActionService(container) {
  return new ActionService(container);
}
