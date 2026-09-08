/**
 * core/browser/session.js
 * ========================
 * Groups Odoo server connection configuration and session management
 * (API key + logged-in user identity), persisted in
 * localStorage to survive offline reloads/restarts.
 */

export const CONFIG = {
  ODOO_BASE_URL: "http://localhost:8069",
};

const SESSION_STORAGE_KEY = "offline_sync_session";

/** Reads the complete local session ({ uid, name, api_key }), or null if absent. */
export function getSession() {
  const raw = localStorage.getItem(SESSION_STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

/** Saves the local session (called immediately after a successful login). */
export function saveSession(session) {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

/** Clears the local session (log out, or invalid API key on the server side). */
export function clearSession() {
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

/** Shortcut: API key for the current session, or null if not logged in. */
export function getApiKey() {
  const session = getSession();
  return session ? session.api_key : null;
}

/** Shortcut: Odoo user ID of the current session, or null. */
export function getUserId() {
  const session = getSession();
  return session ? session.uid : null;
}
