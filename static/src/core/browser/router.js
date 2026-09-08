/**
 * core/browser/router.js
 * =======================
 * Synchronizes the application's navigation state with the browser's
 * URL via history.pushState/popstate and a serialized hash
 * (#action=home_menu, #action=list_view&model=res.partner&view=list...).
 */

/** 
 * Converts a URL fragment string 
 * (e.g., #action=list&model=sale.order&id=15) into a simple JS object. */
function parseHash(hash) {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const params = new URLSearchParams(raw);
  const state = {};
  for (const [key, value] of params.entries()) {
    state[key] = value;
  }
  return state;
}

/** 
 * Inverse function of parseHash.
 * It converts a JS state object into a formatted URL query string.
 */
function stateToHash(state) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(state || {})) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  }
  return params.toString();
}

class Router {
  constructor() {
    /** Current state, always synchronized with location.hash. */
    this.current = parseHash(window.location.hash);
    this._listeners = [];

    // Browser back/forward buttons: window.history preserves
    // the exact state passed to pushState/replaceState (no need to
    // re-parse the hash if present — more reliable, especially if two
    // states serialize to the same hash).
    window.addEventListener("popstate", (event) => {
      this.current = event.state || parseHash(window.location.hash);
      this._notify();
    });
  }

  /**
   * Navigates to a new screen and creates a new entry in the browser history
   * (the user will be able to go back using the Back button)
   */
  pushState(state) {
    this.current = { ...state };
    const hash = "#" + stateToHash(this.current);
    window.history.pushState(this.current, "", hash);
  }

  /**
   * Updates the state and URL without creating a new history entry 
   * (e.g., page change in a pager, column sorting).
   */
  replaceState(state) {
    this.current = { ...state };
    const hash = "#" + stateToHash(this.current);
    window.history.replaceState(this.current, "", hash);
  }

  /**
   * Subscribes to state changes triggered by browser navigation
   * (popstate). Returns an unsubscribe function.
   */
  onStateChange(callback) {
    this._listeners.push(callback);
    return () => {
      this._listeners = this._listeners.filter((cb) => cb !== callback);
    };
  }

  _notify() {
    for (const callback of this._listeners) {
      callback(this.current);
    }
  }
}

/**
 * Single router shared by the entire application.
 */
export const router = new Router();
