/**
 * core/bus/bus_service.js
*/

import { registry } from "../registry.js";

export class EventBus extends EventTarget {
  /**
   * Triggers a named event with a payload (detail).
   * Equivalent to Odoo's bus.trigger(name, payload).
   */
  trigger(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }

  /**
   * Explicit alias for addEventListener, for readability on the caller side
   * (symmetrical to trigger). The native addEventListener can still be used
   * directly if preferred.
   */
  subscribe(name, callback, options) {
    this.addEventListener(name, callback, options);
    return () => this.unsubscribe(name, callback, options);
  }

  unsubscribe(name, callback, options) {
    this.removeEventListener(name, callback, options);
  }
}

/**
 * A single bus shared by the entire application (like the native "bus"
 * service, which is a singleton resolved once by the service registry).
 */
export const bus = new EventBus();

/**
 * Explicit service for the registry, in case other modules
 * prefer to resolve it via registry.category("services").get("bus")
 * rather than a direct import—both approaches coexist in
 * native Odoo, depending on the module.
 */
export const busService = {
  start() {
    return bus;
  },
};

registry.category("services").add("bus", busService);
