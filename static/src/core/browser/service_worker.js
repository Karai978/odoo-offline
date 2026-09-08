/**
 * core/browser/service_worker.js
 */

export function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("/service-worker.js")
      .then(() => console.log("Service Worker enregistré"))
      .catch((err) => console.error("Échec Service Worker :", err));
  }
}
