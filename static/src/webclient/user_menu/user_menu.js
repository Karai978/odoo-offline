import { getSession, clearSession } from "../../core/browser/session.js";
import { getSyncQueueSummary } from "../../core/network/rpc_service.js";
import { getCachedProfile } from "../../core/user_service.js";
import { db } from "../../core/orm_service.js";
import { createDropdown } from "../../core/dropdown/dropdown.js";

export function mountUserMenu(rootEl, actionService) {
  const btn = rootEl.querySelector("#user-menu-btn");
  const dropdown = rootEl.querySelector("#user-menu-dropdown");

  let view = "menu";

  async function render() {
    dropdown.innerHTML = "";
    if (view === "account") {
      await renderAccountView();
    } else {
      renderMainMenu();
    }
  }

  function renderMainMenu() {
    const session = getSession();
    const header = document.createElement("div");
    header.className = "px-3 py-2 border-bottom";
    header.innerHTML = `<div class="fw-bold small">${session?.name || ""}</div>`;
    dropdown.appendChild(header);

    const items = [
      { id: "documentation", label: "Documentation", action: openDocumentation },
      { id: "support", label: "Support", action: openSupport },
      { id: "my_account", label: "Mon compte", action: () => switchView("account") },
      { id: "log_out", label: "Se déconnecter", action: logout, danger: true },
    ];

    items.forEach((item) => {
      const link = document.createElement("a");
      link.href = "#";
      link.className = "dropdown-item small" + (item.danger ? " text-danger" : "");
      link.textContent = item.label;
      link.addEventListener("click", (e) => {
        e.preventDefault();
        item.action();
      });
      dropdown.appendChild(link);
    });
  }

  async function renderAccountView() {
    const session = getSession();
    const [profile, security] = await Promise.all([
      getCachedProfile(),
      getCachedSecuritySummary(),
    ]);

    const header = document.createElement("div");
    header.className = "d-flex align-items-center gap-2 px-3 py-2 border-bottom";
    header.innerHTML = `<a href="#" class="text-muted" id="account-back">&larr;</a><strong class="small">Mon compte</strong>`;
    dropdown.appendChild(header);
    header.querySelector("#account-back").addEventListener("click", (e) => {
      e.preventDefault();
      switchView("menu");
    });

    const body = document.createElement("div");
    body.className = "px-3 py-2";
    body.innerHTML = `
      <div class="mb-2">
        <div class="text-muted" style="font-size:11px;">Nom</div>
        <div class="small">${session?.name || "—"}</div>
      </div>
      <div class="mb-2">
        <div class="text-muted" style="font-size:11px;">Société</div>
        <div class="small">${profile?.companyName || "—"}</div>
      </div>
      <div class="mb-2">
        <div class="text-muted" style="font-size:11px;">UID Odoo</div>
        <div class="small">${session?.uid ?? "—"}</div>
      </div>
      <div class="mb-2">
        <div class="text-muted" style="font-size:11px;">Rôle</div>
        <div class="small">${security.isAdmin ? "Administrateur" : "Utilisateur"}</div>
      </div>
    `;
    dropdown.appendChild(body);
  }

  function switchView(next) {
    view = next;
    render();
  }

  async function getCachedSecuritySummary() {
    const entries = await db.security_info.toArray();
    if (entries.length === 0) return { groups: [], isAdmin: false };
    return { groups: entries[0].groups || [], isAdmin: !!entries[0].is_admin };
  }

  function openDocumentation() {
    window.open("https://www.odoo.com/documentation/17.0/", "_blank");
  }

  function openSupport() {
    window.open("https://www.odoo.com/help", "_blank");
  }

  async function logout() {
    const summary = await getSyncQueueSummary();
    if (summary.pending > 0 || summary.error > 0) {
      const total = summary.pending + summary.error;
      const confirmed = confirm(`${total} action(s) non synchronisée(s) avec Odoo. Se déconnecter quand même ?`);
      if (!confirmed) return;
    }
    clearSession();
    actionService.doAction("login", { replace: true, clearStack: true });
  }

  const menu = createDropdown(btn, dropdown, {
    onOpen: () => {
      view = "menu"; // toujours repartir du menu principal à l'ouverture
      render();
    },
  });

  return {
    destroy: menu.destroy,
  };
}