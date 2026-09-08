/**
 * webclient/navbar/sync_status_panel.js
 */
import { bus } from "../../core/bus/bus_service.js";
import { createDropdown } from "../../core/browser/dropdown_menu.js";
import {
  getSyncQueueSummary,
  getSyncErrorEntries,
  getSyncPendingEntries,
  retryAllSyncErrors,
  retrySyncAction,
  deleteSyncAction,
  syncPendingActions,
} from "../../core/network/rpc_service.js";

function formatSyncEntryTitle(entry) {
  const opLabels = { create: "Création", write: "Modification", unlink: "Suppression" };
  const opLabel = opLabels[entry.operation] || entry.operation;
  return `${opLabel} — ${entry.model_name}`;
}

export function mountSyncStatusPanel(rootEl) {
  const btn = rootEl.querySelector("#sync-status-btn");
  const dropdown = rootEl.querySelector("#sync-status-dropdown");
  const errorBadge = rootEl.querySelector("#badge-sync-errors");
  const pendingBadge = rootEl.querySelector("#badge-sync-pending");

  async function refreshSyncStatus() {
    const summary = await getSyncQueueSummary();

    if (summary.error > 0) {
      errorBadge.textContent = summary.error;
      errorBadge.style.display = "inline-block";
    } else {
      errorBadge.style.display = "none";
    }

    if (summary.pending > 0) {
      pendingBadge.textContent = summary.pending;
      pendingBadge.title = navigator.onLine
        ? "En cours de synchronisation..."
        : "En attente de connexion pour synchroniser";
      pendingBadge.style.display = "inline-block";
    } else {
      pendingBadge.style.display = "none";
    }

    if (dropdown.classList.contains("show")) {
      await renderSyncErrorsPanel();
    }
  }

  async function renderSyncErrorsPanel() {
    const [errors, pendingEntries] = await Promise.all([
      getSyncErrorEntries(),
      getSyncPendingEntries(),
    ]);
    dropdown.innerHTML = "";

    const header = document.createElement("div");
    header.className = "d-flex justify-content-between align-items-center px-3 py-2 border-bottom";
    const title = document.createElement("strong");
    title.className = "small";
    if (errors.length > 0) {
      title.textContent = `${errors.length} erreur(s) de synchronisation`;
    } else if (pendingEntries.length > 0) {
      title.textContent = navigator.onLine
        ? `${pendingEntries.length} en cours de synchronisation...`
        : `${pendingEntries.length} en attente de connexion`;
    } else {
      title.textContent = "Synchronisation";
    }
    header.appendChild(title);

    if (errors.length > 0) {
      const retryAllBtn = document.createElement("button");
      retryAllBtn.type = "button";
      retryAllBtn.className = "btn btn-sm btn-link p-0";
      retryAllBtn.textContent = "Tout réessayer";
      retryAllBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        retryAllBtn.disabled = true;
        retryAllBtn.textContent = "...";
        await retryAllSyncErrors();
        await refreshSyncStatus();
      });
      header.appendChild(retryAllBtn);
    }
    dropdown.appendChild(header);

    if (pendingEntries.length > 0) {
      const pendingSection = document.createElement("div");
      pendingSection.className = "px-3 py-2 border-bottom bg-light";

      const pendingLabel = document.createElement("div");
      pendingLabel.className = "text-muted small mb-1";
      pendingLabel.textContent = navigator.onLine
        ? "En cours d'envoi vers Odoo..."
        : "Hors-ligne — seront envoyées à la reconnexion :";
      pendingSection.appendChild(pendingLabel);

      pendingEntries.forEach((entry) => {
        const line = document.createElement("div");
        line.className = "small d-flex align-items-center gap-2";
        const icon = document.createElement("i");
        icon.className = navigator.onLine ? "fa fa-spinner fa-spin text-muted" : "fa fa-clock-o text-muted";
        const label = document.createElement("span");
        label.textContent = formatSyncEntryTitle(entry);
        line.appendChild(icon);
        line.appendChild(label);
        pendingSection.appendChild(line);
      });

      dropdown.appendChild(pendingSection);
    }

    if (errors.length === 0) {
      const empty = document.createElement("div");
      empty.className = "text-muted text-center p-4 small";
      empty.textContent = "Aucune erreur de synchronisation.";
      dropdown.appendChild(empty);
      return;
    }

    errors.forEach((entry) => {
      const item = document.createElement("div");
      item.className = "px-3 py-2 border-bottom";

      const titleEl = document.createElement("div");
      titleEl.className = "fw-bold small";
      titleEl.textContent = formatSyncEntryTitle(entry);
      item.appendChild(titleEl);

      const dateEl = document.createElement("div");
      dateEl.className = "text-muted small";
      dateEl.textContent = entry.created_at;
      item.appendChild(dateEl);

      const msgEl = document.createElement("div");
      msgEl.className = "small text-danger mt-1";
      msgEl.style.wordBreak = "break-word";
      msgEl.textContent = entry.error_message || "Erreur inconnue.";
      item.appendChild(msgEl);

      const actions = document.createElement("div");
      actions.className = "d-flex gap-2 mt-2";

      const retryBtn = document.createElement("button");
      retryBtn.type = "button";
      retryBtn.className = "btn btn-sm btn-outline-secondary";
      retryBtn.textContent = "Réessayer";
      retryBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        retryBtn.disabled = true;
        retryBtn.textContent = "...";
        await retrySyncAction(entry.id);
        await refreshSyncStatus();
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "btn btn-sm btn-outline-danger";
      deleteBtn.textContent = "Supprimer";
      deleteBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm("Supprimer définitivement cette action non synchronisée ? L'enregistrement devra être recréé.")) return;
        await deleteSyncAction(entry.id);
        await refreshSyncStatus();
      });

      actions.appendChild(retryBtn);
      actions.appendChild(deleteBtn);
      item.appendChild(actions);

      dropdown.appendChild(item);
    });
  }
  
  const panel = createDropdown(btn, dropdown, {
    onOpen: () => renderSyncErrorsPanel(),
  });

  let syncInFlight = false;
  async function attemptAutoSync() {
    if (syncInFlight || !navigator.onLine) {
      await refreshSyncStatus();
      return;
    }
    const summary = await getSyncQueueSummary();
    if (summary.pending === 0) {
      await refreshSyncStatus();
      return;
    }
    syncInFlight = true;
    try {
      await syncPendingActions();
    } catch (err) {
      console.warn("Tentative de synchro automatique échouée, sera retentée:", err);
    } finally {
      syncInFlight = false;
      await refreshSyncStatus();
      bus.trigger("sync:updated");
    }
  }

  window.addEventListener("online", attemptAutoSync);
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") attemptAutoSync();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

  const onSyncUpdated = () => refreshSyncStatus();
  bus.addEventListener("sync:updated", onSyncUpdated);

  refreshSyncStatus();

  return {
    refreshSyncStatus,
    attemptAutoSync,
    destroy() {
      panel.destroy();
      window.removeEventListener("online", attemptAutoSync);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      bus.removeEventListener("sync:updated", onSyncUpdated);
    },
  };
}
