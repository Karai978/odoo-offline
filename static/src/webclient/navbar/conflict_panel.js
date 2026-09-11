/**
 * webclient/navbar/conflict_panel.js
 * Liste compacte des conflits en attente — cliquer sur une entrée ouvre
 * la page de détail (conflict_detail.js) pour la comparaison complète
 * et la résolution. Ce panel ne fait que lister et naviguer, il ne
 * résout plus rien lui-même.
 */

import { bus } from "../../core/bus/bus_service.js";
import { getCachedConflicts } from "../../core/network/rpc_service.js";
import { createDropdown } from "../../core/dropdown/dropdown.js";

function formatFieldLabel(fieldName) {
  const match = fieldName.match(/^(.+)\[(\d+)\]$/);
  if (match) return `${match[1]} (ligne #${match[2]})`;
  return fieldName;
}

export function mountConflictPanel(rootEl, actionService) {
  const btn = rootEl.querySelector("#conflict-status-btn");
  const dropdown = rootEl.querySelector("#conflict-status-dropdown");
  const badge = rootEl.querySelector("#badge-sync-conflicts");

  async function refreshConflictStatus() {
    const conflicts = await getCachedConflicts();
    if (conflicts.length > 0) {
      badge.textContent = conflicts.length;
      badge.style.display = "inline-block";
    } else {
      badge.style.display = "none";
    }

    if (dropdown.classList.contains("show")) {
      await renderConflictsList();
    }
    return conflicts;
  }

  async function renderConflictsList() {
    const conflicts = await getCachedConflicts();
    dropdown.innerHTML = "";

    const header = document.createElement("div");
    header.className = "px-3 py-2 border-bottom";
    const title = document.createElement("strong");
    title.className = "small";
    title.textContent = conflicts.length > 0
      ? `${conflicts.length} conflit(s) à résoudre`
      : "Conflits de synchronisation";
    header.appendChild(title);
    dropdown.appendChild(header);

    if (conflicts.length === 0) {
      const empty = document.createElement("div");
      empty.className = "text-muted text-center p-4 small";
      empty.textContent = "Aucun conflit en attente.";
      dropdown.appendChild(empty);
      return;
    }

    conflicts.forEach((entry) => {
      const fieldNames = entry.conflicts.map((c) => formatFieldLabel(c.field)).join(", ");

      const item = document.createElement("a");
      item.href = "#";
      item.className = "dropdown-item small py-2 border-bottom";
      item.innerHTML = `
        <div class="fw-bold">${entry.model_name}</div>
        <div class="text-muted text-truncate" style="font-size:11px;">${fieldNames}</div>
        <div class="text-muted" style="font-size:11px;">${entry.created_at || ""}</div>
      `;
      item.addEventListener("click", (e) => {
        e.preventDefault();
        dropdown.classList.remove("show");
        actionService.doAction({ tag: "conflict_detail", localUuid: entry.local_uuid });
      });
      dropdown.appendChild(item);
    });
  }

  const panel = createDropdown(btn, dropdown, {
    onOpen: () => renderConflictsList(),
  });

  const onSyncUpdated = () => refreshConflictStatus();
  bus.addEventListener("sync:updated", onSyncUpdated);

  refreshConflictStatus();

  return {
    refreshConflictStatus,
    destroy() {
      panel.destroy();
      bus.removeEventListener("sync:updated", onSyncUpdated);
    },
  };
}