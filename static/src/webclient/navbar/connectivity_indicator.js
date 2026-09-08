/**
 * webclient/navbar/connectivity_indicator.js
 */

import { CONFIG } from "../../core/browser/session.js";

export function mountConnectivityIndicator(rootEl) {
  const dot = rootEl.querySelector("#connectivity-dot");
  const wrapper = rootEl.querySelector("#connectivity-indicator");
  let lastKnownOnlineState = null;
  let intervalId = null;

  async function checkRealConnectivity() {
    if (!navigator.onLine) return false;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const response = await fetch(`${CONFIG.ODOO_BASE_URL}/offline_sync/ping`, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response.ok;
    } catch (err) {
      return false;
    }
  }

  async function updateConnectivityIndicator() {
    if (!dot) return;

    const isOnline = await checkRealConnectivity();
    if (isOnline === lastKnownOnlineState) return;
    lastKnownOnlineState = isOnline;

    if (isOnline) {
      dot.style.backgroundColor = "#28a745";
      dot.style.boxShadow = "0 0 4px rgba(40, 167, 69, 0.6)";
    } else {
      dot.style.backgroundColor = "#dc3545";
      dot.style.boxShadow = "0 0 4px rgba(220, 53, 69, 0.6)";
    }

    if (wrapper) wrapper.title = isOnline ? "En ligne" : "Hors ligne";
  }

  window.addEventListener("online", updateConnectivityIndicator);
  window.addEventListener("offline", updateConnectivityIndicator);
  updateConnectivityIndicator();
  intervalId = setInterval(updateConnectivityIndicator, 5000);

  return () => {
    window.removeEventListener("online", updateConnectivityIndicator);
    window.removeEventListener("offline", updateConnectivityIndicator);
    clearInterval(intervalId);
  };
}
