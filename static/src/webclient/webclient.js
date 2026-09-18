/**
 * webclient/webclient.js
 */

import { mountAppsMenu } from "./navbar/apps_menu.js";
import "./conflict_detail.js";
import { router } from "../core/browser/router_service.js";
import { bus } from "../core/bus/bus_service.js";
import { CONFIG, getApiKey } from "../core/browser/session.js";
import { createActionService } from "./actions/action_service.js";
import { getModuleManifest } from "../views/view_service.js";
import { buildMenuTree, findFirstModel, renderHorizontalMenu, resolveNaturalLanding } from "./navbar/navbar.js";
import { mountSyncStatusPanel } from "./navbar/sync_status_panel.js";
import { mountConnectivityIndicator } from "./navbar/connectivity_indicator.js";
import { mountConflictPanel } from "./navbar/conflict_panel.js"; 
import { mountUserMenu } from "./user_menu/user_menu.js";
import { loadOdooAssets, unloadOdooAssets } from "../core/assets.js";

const NAVBAR_TEMPLATE = `
<header class="o_navbar">
  <nav class="o_main_navbar" data-command-category="disabled">
    <div class="o-dropdown dropdown o_navbar_apps_menu o-dropdown--no-caret">
      <button id="back-btn" type="button" class="dropdown-toggle" title="Accueil" tabindex="0">
        <i class="oi oi-apps"></i>
      </button>
    </div>
    <a id="app-title" class="dropdown-item o_menu_brand d-none d-md-flex" role="menuitem" tabindex="0"></a>
    <div id="menu-horizontal" class="o_menu_sections d-none d-md-flex flex-grow-1 flex-shrink-1 w-0" role="menu"></div>
    <div class="o_menu_systray d-flex flex-shrink-0 ms-auto" role="menu">
      <div id="connectivity-indicator" class="d-flex align-items-center px-2" title="Statut de connexion">
        <span id="connectivity-dot" class="rounded-circle d-inline-block" style="width:10px; height:10px;"></span>
      </div>
      <div class="o-dropdown dropdown o-mail-DiscussSystray-class o-dropdown--no-caret">
        <button type="button" class="dropdown-toggle" tabindex="0" aria-expanded="false">
          <i class="fa fa-lg fa-comments" role="img" aria-label="Messages"></i>
          <span id="badge-messages" class="o-mail-MessagingMenu-counter badge rounded-pill" style="display:none;"></span>
        </button>
      </div>
      <div class="o-dropdown dropdown o-mail-DiscussSystray-class o-dropdown--no-caret">
        <button type="button" class="dropdown-toggle" tabindex="0" aria-expanded="false">
          <i class="fa fa-lg fa-clock-o" role="img" aria-label="Activités"></i>
          <span id="badge-activities" class="o-mail-ActivityMenu-counter badge rounded-pill" style="display:none;"></span>
        </button>
      </div>
      <div class="o-dropdown dropdown o_sync_errors_menu o-dropdown--no-caret">
        <button id="sync-status-btn" type="button" class="dropdown-toggle position-relative" tabindex="0" aria-expanded="false" title="Synchronisation">
          <i class="fa fa-lg fa-cloud-upload" role="img" aria-label="Synchronisation"></i>
          <span id="badge-sync-pending" class="o-mail-MessagingMenu-counter badge rounded-pill bg-secondary" style="display:none;"></span>
          <span id="badge-sync-errors" class="o-mail-MessagingMenu-counter badge rounded-pill bg-danger" style="display:none;"></span>
        </button>
        <div id="sync-status-dropdown" class="dropdown-menu dropdown-menu-end p-0" style="min-width: 340px; max-height: 420px; overflow-y: auto;"></div>
      </div>
      <div class="o-dropdown dropdown o_sync_conflicts_menu o-dropdown--no-caret">
        <button id="conflict-status-btn" type="button" class="dropdown-toggle position-relative" tabindex="0" aria-expanded="false" title="Conflits de synchronisation">
          <i class="fa fa-lg fa-exclamation-triangle" role="img" aria-label="Conflits"></i>
          <span id="badge-sync-conflicts" class="o-mail-MessagingMenu-counter badge rounded-pill bg-warning" style="display:none;"></span>
        </button>
        <div id="conflict-status-dropdown" class="dropdown-menu dropdown-menu-end p-0" style="min-width: 340px; max-height: 420px; overflow-y: auto;"></div>
      </div>
      <div class="o-dropdown dropdown o_apps_download_menu o-dropdown--no-caret">
        <button id="apps-download-btn" type="button" class="dropdown-toggle" tabindex="0" aria-expanded="false" title="Applications">
          <i class="fa fa-lg fa-th-large" role="img" aria-label="Applications"></i>
        </button>
        <div id="apps-download-dropdown" class="dropdown-menu dropdown-menu-end p-0" style="min-width: 300px; max-height: 420px; overflow-y: auto;"></div>
      </div>
      <div class="o-dropdown dropdown o_switch_company_menu d-none d-md-block o-dropdown--no-caret">
        <button type="button" class="dropdown-toggle" tabindex="0" aria-expanded="false">
          <i class="fa fa-building d-lg-none"></i>
          <span id="shell-company-name" class="oe_topbar_name d-none d-lg-block"></span>
        </button>
      </div>
      <div>
        <button class="o_mobile_menu_toggle o_nav_entry o-no-caret d-md-none border-0 pe-3" title="Basculer le menu" aria-label="Basculer le menu">
          <i class="oi oi-panel-right"></i>
        </button>
      </div>
      <div class="o-dropdown dropdown o_user_menu d-none d-md-block pe-0 o-dropdown--no-caret">
        <button id="user-menu-btn" type="button" class="dropdown-toggle py-1 py-lg-0" tabindex="0" aria-expanded="false">
          <span id="shell-user-avatar" class="o_avatar o_user_avatar rounded-circle d-inline-flex align-items-center justify-content-center"></span>
          <small id="shell-user-name" class="oe_topbar_name d-none ms-2 text-start lh-1 text-truncate"></small>
        </button>
        <div id="user-menu-dropdown" class="dropdown-menu dropdown-menu-end" style="min-width: 220px;"></div>
      </div>
    </div>
  </nav>
</header>
`;

function detectTouchDevice() {
  if (navigator.maxTouchPoints > 0 || window.matchMedia("(pointer: coarse)").matches) {
    document.body.classList.add("o_touch_device");
  }
}

function ensureWebclientSkeleton() {
  let navbarRoot = document.getElementById("webclient-navbar-root");
  if (!navbarRoot) {
    navbarRoot = document.createElement("div");
    navbarRoot.id = "webclient-navbar-root";
    navbarRoot.style.display = "none";
    navbarRoot.innerHTML = NAVBAR_TEMPLATE;
    document.body.appendChild(navbarRoot);
  }

  let container = document.getElementById("action-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "action-container";
    document.body.appendChild(container);
  }
  container.style.flex = "1";
  container.style.overflow = "auto";
  container.style.display = "flex";
  container.style.flexDirection = "column";

  let toastContainer = document.getElementById("conflict-toast-container");
  if (!toastContainer) {
    toastContainer = document.createElement("div");
    toastContainer.id = "conflict-toast-container";
    toastContainer.style.cssText =
      "position:fixed; top:60px; right:16px; z-index:2000; display:flex; flex-direction:column; gap:8px; max-width:320px;";
    document.body.appendChild(toastContainer);
  }

  return { navbarRoot, container, toastContainer };
}

const NAVBAR_VISIBLE_TAGS = new Set(["home_menu", "list_view", "form_view", "ir.actions.act_window", "conflict_detail"]);

export function mountWebclient() {
  detectTouchDevice();

  const { navbarRoot, container, toastContainer } = ensureWebclientSkeleton();
  const actionService = createActionService(container);

  const syncStatusPanel = mountSyncStatusPanel(navbarRoot);
  mountConflictPanel(navbarRoot, actionService);
  mountConnectivityIndicator(navbarRoot);
  mountUserMenu(navbarRoot, actionService);
  mountAppsMenu(navbarRoot);

  const appTitleEl = navbarRoot.querySelector("#app-title");
  const menuHorizontalEl = navbarRoot.querySelector("#menu-horizontal");
  const backBtn = navbarRoot.querySelector("#back-btn");
  const mobileToggleBtn = navbarRoot.querySelector(".o_mobile_menu_toggle");

  backBtn.addEventListener("click", () => {
    actionService.doAction("home_menu", { clearStack: true });
  });

  if (mobileToggleBtn) {
    mobileToggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      document.body.classList.toggle("o_mobile_menu_toggle_open");
      menuHorizontalEl.classList.toggle("show");
    });
    document.addEventListener("click", (e) => {
      if (!menuHorizontalEl.contains(e.target) && !mobileToggleBtn.contains(e.target)) {
        document.body.classList.remove("o_mobile_menu_toggle_open");
        menuHorizontalEl.classList.remove("show");
      }
    });
  }

  let lastMenuModule = null;
  let navbarCssLoaded = false;

  async function ensureMenuForModule(module, currentParams) {
    if (module === lastMenuModule) return;
    lastMenuModule = module;

    try {
      const manifest = await getModuleManifest(module, getApiKey(), CONFIG.ODOO_BASE_URL);
      appTitleEl.textContent = manifest.module.label;

      const tree = buildMenuTree(manifest.menus);
      let rootMenu = tree[0] || { children: [] };
      let maxChildren = rootMenu.children.length;
      for (const candidate of tree) {
        if (candidate.children.length > maxChildren) {
          rootMenu = candidate;
          maxChildren = candidate.children.length;
        }
      }

      renderHorizontalMenu(rootMenu, menuHorizontalEl, (model, name, actionId, defaultView) => {
        actionService.doAction({ tag: "list_view", module, model, actionId, view: defaultView, label: name });
      });

      if (!currentParams.actionId) {
        const naturalLanding = rootMenu.model
          ? { model: rootMenu.model, name: rootMenu.name, actionId: rootMenu.action_id, defaultView: rootMenu.default_view }
          : findFirstModel(rootMenu);

        if (naturalLanding && (naturalLanding.model !== currentParams.model || naturalLanding.actionId)) {
          actionService.doAction(
            { tag: "list_view", module, model: naturalLanding.model, actionId: naturalLanding.actionId, view: naturalLanding.defaultView, label: naturalLanding.name },
            { replace: true }
          );
        }
      }
    } catch (err) {
      console.error("Impossible de charger le menu du module", module, err);
      appTitleEl.textContent = "Erreur de chargement";
    }
  }

  bus.addEventListener("action:changed", (ev) => {
    const { tag, params } = ev.detail;
    const shouldShowNavbar = NAVBAR_VISIBLE_TAGS.has(tag);

    if (shouldShowNavbar && !navbarCssLoaded) {
      loadOdooAssets();
      navbarCssLoaded = true;
    } else if (!shouldShowNavbar && navbarCssLoaded) {
      unloadOdooAssets();
      navbarCssLoaded = false;
    }

    if (shouldShowNavbar) {
      document.body.classList.remove("bg-100");
      document.body.classList.add("o_web_client");
    } else {
      document.body.classList.remove("o_web_client");
      document.body.classList.add("bg-100");
    }

    if (!shouldShowNavbar) {
      navbarRoot.style.display = "none";
      lastMenuModule = null;
      return;
    }

    navbarRoot.style.display = "";

    const isHomeMenu = tag === "home_menu";

    if (isHomeMenu) {
      appTitleEl.textContent = "";
      menuHorizontalEl.innerHTML = "";
      lastMenuModule = null;
      return;
    }

    if (params.module) {
      ensureMenuForModule(params.module, params);
    }
  });

  // Emitted by webclient/home menu/home menu.js — populates the elements of
  // the global navbar (avatar, name, company, message/activity badges).
  bus.addEventListener("user:info", (ev) => {
    const { initial, name, companyName, unreadMessages, pendingActivities } = ev.detail;

    const avatarEl = navbarRoot.querySelector("#shell-user-avatar");
    const nameEl = navbarRoot.querySelector("#shell-user-name");
    const companyEl = navbarRoot.querySelector("#shell-company-name");
    const msgBadge = navbarRoot.querySelector("#badge-messages");
    const actBadge = navbarRoot.querySelector("#badge-activities");

    if (avatarEl) avatarEl.textContent = initial || "?";
    if (nameEl) nameEl.textContent = name || "";
    if (companyEl) companyEl.textContent = companyName || "";

    if (msgBadge) {
      if (unreadMessages > 0) {
        msgBadge.textContent = unreadMessages;
        msgBadge.style.display = "inline-block";
      } else {
        msgBadge.style.display = "none";
      }
    }
    if (actBadge) {
      if (pendingActivities > 0) {
        actBadge.textContent = pendingActivities;
        actBadge.style.display = "inline-block";
      } else {
        actBadge.style.display = "none";
      }
    }
  });

  actionService.restoreState(router.current);

  return actionService;
}