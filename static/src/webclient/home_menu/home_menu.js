/**
 * webclient/home_menu/home_menu.js)
 */

import { CONFIG, getApiKey, getSession, clearSession } from "../../core/browser/session.js";
import { getCachedApps, saveCachedApps } from "../menus/menu_service.js";
import { getCachedModuleManifest, getModuleManifest } from "../../views/view_service.js";
import { downloadFullApp } from "../offline_prefetch_service.js";
import { registry } from "../../core/registry.js";
import { bus } from "../../core/bus/bus_service.js";
import { resolveNaturalLanding } from "../navbar/navbar.js";
import { saveCachedProfile, getCachedProfile } from "../../core/user_service.js";

const CUSTOM_IMPLEMENTATIONS = {};

const HOME_MENU_TEMPLATE = `
  <main class="dashboard-container">
    <div class="search-box">
      <span class="search-icon">
        <img src="assets/search.png" alt="Search" class="local-icon search-img">
      </span>
      <input type="text" placeholder="click here...">
    </div>
    <div class="modules-grid" id="modules-grid"></div>
  </main>
`;

const DASHBOARD_STYLE_ID = "offline-dashboard-style";

function loadDashboardStyle() {
  if (document.getElementById(DASHBOARD_STYLE_ID)) {
    return;
  }

  const link = document.createElement("link");
  link.id = DASHBOARD_STYLE_ID;
  link.rel = "stylesheet";
  link.href = "./static/src/webclient/home_menu/home_menu.css";

  document.head.appendChild(link);
}

function unloadDashboardStyle() {
  const link = document.getElementById(DASHBOARD_STYLE_ID);
  if (link) {
    link.remove();
  }
}

function mountHomeMenu(container, params, env) {
  loadDashboardStyle();

  container.innerHTML = HOME_MENU_TEMPLATE;
  container.classList.add("dashboard-body");

  const grid = container.querySelector("#modules-grid");

  async function openApp(app, cardEl) {
    const custom = CUSTOM_IMPLEMENTATIONS[app.technical_name];
    if (custom) {
      env.doAction(custom.action);
      return;
    }

    const downloadBtn = cardEl?.querySelector(".download-btn");
    const originalLabel = cardEl?.querySelector("p")?.textContent;
    if (cardEl) cardEl.style.opacity = "0.6";

    try {
      const manifest = await getModuleManifest(app.technical_name, getApiKey(), CONFIG.ODOO_BASE_URL);
      const landing = resolveNaturalLanding(manifest);

      if (landing) {
        env.doAction({
          tag: "list_view",
          module: app.technical_name,
          model: landing.model,
          actionId: landing.actionId,
          view: landing.defaultView,
          label: landing.name,
        });

      } else {
        env.doAction({ tag: "list_view", module: app.technical_name, model: app.main_model });
      }
    } catch (err) {
      console.error(`Impossible de résoudre le menu de ${app.technical_name} :`, err);
      env.doAction({ tag: "list_view", module: app.technical_name, model: app.main_model });
    } finally {
      if (cardEl) cardEl.style.opacity = "";
    }
  }

  async function renderModulesGrid(apps) {
    grid.innerHTML = "";

    if (!apps || apps.length === 0) {
      grid.innerHTML = "<p>Aucune app détectée. Connecte-toi en ligne au moins une fois.</p>";
      return;
    }

    for (const app of apps) {
      const custom = CUSTOM_IMPLEMENTATIONS[app.technical_name];
      const hasModel = !!app.main_model;
      const isReady = custom || hasModel;

      const card = document.createElement("div");
      card.className = "module-card";
      if (!isReady) card.classList.add("disabled");
      else card.classList.add("ready");

      const iconSrc = app.icon_base64 || "assets/default-app.png";
      const cachedManifest = isReady ? await getCachedModuleManifest(app.technical_name) : null;
      const isCached = !!cachedManifest;

      card.innerHTML = `
        <div class="icon-wrapper"><img src="${iconSrc}" alt="${app.label}" onerror="this.src='assets/default-app.png'"></div>
        <p>${app.label}</p>
      `;

      if (isReady) {
        card.addEventListener("click", () => openApp(app, card));
      }

      grid.appendChild(card);
    }
  }

  async function refreshInstalledApps() {
    if (!navigator.onLine) {
      renderModulesGrid(await getCachedApps());
      return;
    }
    
    try {
      const response = await fetch(`${CONFIG.ODOO_BASE_URL}/offline_sync/installed_apps`, {
        headers: { Authorization: `Bearer ${getApiKey()}` },
      });

      if (!response.ok) {
        if (response.status === 401) {
          clearSession();
          env.doAction("login", { replace: true, clearStack: true });
          return;
        }
        throw new Error("Erreur serveur");
      }

      const data = await response.json();
      await saveCachedApps(data.apps);
      renderModulesGrid(data.apps);
    } catch (err) {
        console.warn("Impossible de contacter Odoo — liste locale utilisée:", err);
        renderModulesGrid(await getCachedApps());
    }
  }

  async function loadDashboardInfo() {
    try {
      const response = await fetch(`${CONFIG.ODOO_BASE_URL}/offline_sync/dashboard_info`, {
        headers: { Authorization: `Bearer ${getApiKey()}` },
      });
      if (!response.ok) {
        if (response.status === 401) {
          clearSession();
          env.doAction("login", { replace: true, clearStack: true });
        }
        return;
      }
      const data = await response.json();

      // Mise en cache pour que "Mon compte" reste disponible hors-ligne,
      // même depuis un écran autre que le dashboard.
      await saveCachedProfile({
        name: data.name,
        initial: data.initial,
        companyName: data.company_name,
      });

      bus.trigger("user:info", {
        initial: data.initial,
        name: data.name,
        companyName: data.company_name,
        unreadMessages: data.unread_messages,
        pendingActivities: data.pending_activities,
      });

    } catch (err) {
      const session = getSession();
      const cachedProfile = await getCachedProfile();

      if (cachedProfile) {
        bus.trigger("user:info", {
          initial: cachedProfile.initial,
          name: cachedProfile.name,
          companyName: cachedProfile.companyName,
        });
      } else if (session) {
        bus.trigger("user:info", { initial: (session.name || "?")[0].toUpperCase(), name: session.name });
      }
      console.warn("Impossible de charger les infos du tableau de bord (hors ligne ?)", err);
    }
  }

  (async () => {
    await renderModulesGrid(await getCachedApps());
    await loadDashboardInfo();
  })();

  return {
    destroy() {
      unloadDashboardStyle();
    },
  };
}

registry.category("actions").add("home_menu", { mount: mountHomeMenu });

export { mountHomeMenu };
