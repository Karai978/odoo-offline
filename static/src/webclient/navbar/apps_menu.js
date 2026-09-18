/**
 * webclient/navbar/apps_menu.js
 * Liste des applications et leur statut (Installé / Non installé),
 * avec téléchargement -- même principe que conflict_panel.js/user_menu.js :
 * un dropdown ancré à l'icône de la navbar.
 */
import { CONFIG, getApiKey } from "../../core/browser/session.js";
import { getCachedApps } from "../menus/menu_service.js";
import { getCachedModuleManifest } from "../../views/view_service.js";
import { downloadFullApp } from "../offline_prefetch_service.js";
import { createDropdown } from "../../core/dropdown/dropdown.js";

export function mountAppsMenu(rootEl) {
  const btn = rootEl.querySelector("#apps-download-btn");
  const dropdown = rootEl.querySelector("#apps-download-dropdown");

  async function renderAppsList() {
    dropdown.innerHTML = "";

    const header = document.createElement("div");
    header.className = "px-3 py-2 border-bottom";
    header.innerHTML = `<strong class="small">Applications</strong>`;
    dropdown.appendChild(header);

    const apps = await getCachedApps();
    if (!apps || apps.length === 0) {
      const empty = document.createElement("div");
      empty.className = "text-muted text-center p-4 small";
      empty.textContent = "Aucune app détectée. Connectez-vous en ligne au moins une fois.";
      dropdown.appendChild(empty);
      return;
    }

    // Statut de chaque app calculé une seule fois -- réutilisé pour
    // l'affichage des lignes ET pour le résumé installé/non installé.
    const appsWithStatus = [];
    for (const app of apps) {
      const hasModel = !!app.main_model;
      const cachedManifest = hasModel ? await getCachedModuleManifest(app.technical_name) : null;
      appsWithStatus.push({ app, hasModel, isInstalled: !!cachedManifest });
    }

    const installedCount = appsWithStatus.filter((a) => a.hasModel && a.isInstalled).length;
    const notInstalledCount = appsWithStatus.filter((a) => a.hasModel && !a.isInstalled).length;

    const summary = document.createElement("div");
    summary.className = "px-3 py-2 border-bottom text-muted small d-flex justify-content-between";
    summary.innerHTML = `<span>${installedCount} installée(s)</span><span>${notInstalledCount} non installée(s)</span>`;
    dropdown.appendChild(summary);

    for (const { app, hasModel, isInstalled } of appsWithStatus) {
      const row = document.createElement("div");
      row.className = "dropdown-item small py-2 border-bottom d-flex align-items-center justify-content-between";
      row.innerHTML = `
        <div class="d-flex align-items-center gap-2">
          <img src="${app.icon_base64 || "assets/default-app.png"}" alt="" style="width:20px;height:20px;" onerror="this.src='assets/default-app.png'">
          <div>
            <div>${app.label}</div>
            <div class="text-muted" style="font-size:11px;">${hasModel ? (isInstalled ? "Installé" : "Non installé") : "Non pris en charge"}</div>
          </div>
        </div>
      `;

      if (hasModel) {
        const btnDownload = document.createElement("button");
        btnDownload.className = "btn btn-sm btn-outline-primary";
        btnDownload.textContent = isInstalled ? "Mettre à jour" : "Télécharger";
        btnDownload.addEventListener("click", async (e) => {
          e.stopPropagation();
          btnDownload.disabled = true;
          try {
            await downloadFullApp(app.technical_name, getApiKey(), CONFIG.ODOO_BASE_URL, (message) => {
              btnDownload.textContent = message;
            });
            await renderAppsList(); // recalcule le résumé + les badges
          } catch (err) {
            console.error(err);
            btnDownload.textContent = "Échec — réessayer";
            setTimeout(() => { btnDownload.disabled = false; }, 2000);
            return;
          }
        });
        row.appendChild(btnDownload);
      }

      dropdown.appendChild(row);
    }
  }

  const menu = createDropdown(btn, dropdown, {
    onOpen: () => renderAppsList(),
  });

  return { destroy: menu.destroy };
}