/**
 * core/registry.js
 * =================
 * A key-value registry organized into categories (e.g., "services",
 * "actions", "fields", "views"). It is the central mechanism that allows
 * any module to register itself without the rest of the
 * application needing to know about it beforehand.
 * It stores the component in RAM within the application's JavaScript
 * dictionary for the duration of the active browser session.
 */

export class Registry {

  // Initializes a registry instance (root or subcategory)
  constructor(name = null) {
    this.name = name;
    this.parent = null;
    /** @type {Object<string, [number, any]>} key -> [sequence, value]  */
    this.content = {};
    /** @type {Object<string, Registry>} */
    this.subRegistries = {};
    // caches invalidated on every add()/remove()
    this._entries = null;
    this._elements = null;
  }

  /**
   * Returns/retrieves (creating it if necessary) the sub-registry with this name.
   * This is the mechanism that enables "registry.category('actions')".
   */
  category(name) {
    if (!this.subRegistries[name]) {
      const sub = new Registry(name);
      sub.parent = this;
      this.subRegistries[name] = sub;
    }
    return this.subRegistries[name];
  }

  /**
   * Registers a value under a key. By default, an existing key
   * throws an error (as in Odoo) to prevent one module from
   * silently overwriting another—pass { force: true } for an
   * intentional override.
   */
  add(key, value, { force = false, sequence = 50 } = {}) {
    if (!force && key in this.content) {
      throw new Error(
        `Registry${this.name ? ` "${this.name}"` : ""} : la clé "${key}" existe déjà. ` +
        `Utilisez { force: true } pour la remplacer volontairement.`
      );
    }
    this.content[key] = [sequence, value];
    this._entries = null;
    this._elements = null;
    return this; // chainable: registry.add(...).add(...)
  }

  // Removes a component or service from the registry.
  remove(key) {
    delete this.content[key];
    this._entries = null;
    this._elements = null;
  }

  // Checks for the presence of a key without throwing an exception.
  contains(key) {
    return key in this.content;
  }

  /**
   * Retrieves the value associated with a key.
   * Reads a value. If the key is missing, it throws an error,
   * unless an explicit defaultValue is provided (second argument).
   */
  get(key, defaultValue) {
    if (!(key in this.content)) {
      if (arguments.length > 1) return defaultValue;
      throw new Error(
        `Registry${this.name ? ` "${this.name}"` : ""} : clé "${key}" introuvable.`
      );
    }
    return this.content[key][1];
  }

  /** 
   * Returns the list of [key, value] pairs sorted by their sequence value 
   * (ascending order)
   * [[key, value], ...] sorted by ascending sequence. 
   */
  getEntries() {
    if (!this._entries) {
      this._entries = Object.entries(this.content)
        .sort((a, b) => a[1][0] - b[1][0])
        .map(([key, [, value]]) => [key, value]);
    }
    return this._entries.slice();
  }

  /** 
   * Returns only the complete list of values ​​sorted by sequence
   * [value, ...] sorted by ascending sequence (excluding keys). 
   */
  getAll() {
    if (!this._elements) {
      this._elements = this.getEntries().map(([, value]) => value);
    }
    return this._elements.slice();
  }
}

/**
 * Application's single root registry — a single import shared by the entire engine.
 */
export const registry = new Registry();
