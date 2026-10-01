/**
 * core/notification_service.js
 * Bandeau de notification façon Odoo : carte blanche, bordure gauche
 * colorée selon le type, titre en gras, liste à puces optionnelle,
 * bouton de fermeture. Empilable (plusieurs notifications à la fois),
 * positionné en haut à droite.
 */

let container = null;

function getContainer() {
  if (!container) {
    container = document.createElement("div");
    container.className = "o_notification_manager";
    document.body.appendChild(container);
  }
  return container;
}

const ICON_FOR_TYPE = {
  danger: "fa-times-circle",
  success: "fa-check-circle",
  warning: "fa-exclamation-triangle",
  info: "fa-info-circle",
};

/**
 * type: "danger" | "success" | "warning" | "info"
 * title: titre en gras (optionnel, ex: "Champs invalides :")
 * items: liste de lignes affichées en puces (ex: ["Client"]) — prioritaire sur "message"
 * message: ligne unique si pas de liste (ex: "Enregistré et synchronisé avec Odoo")
 * sticky: si true, ne se ferme pas automatiquement (utile pour les erreurs bloquantes)
 * duration: délai avant fermeture auto en ms (ignoré si sticky)
 */
export function notify({ type = "info", title, message, items, sticky = false, duration = 4000 }) {
  const el = document.createElement("div");
  el.className = `o_notification o_notification_fade border-start border-${type} shadow-sm`;
  el.setAttribute("role", "alert");

  const row = document.createElement("div");
  row.className = "d-flex align-items-start p-2";

  const icon = document.createElement("i");
  icon.className = `fa ${ICON_FOR_TYPE[type] || ICON_FOR_TYPE.info} fa-lg text-${type} me-2 mt-1`;
  row.appendChild(icon);

  const content = document.createElement("div");
  content.className = "d-flex flex-column flex-grow-1 pe-3";

  if (title) {
    const titleEl = document.createElement("span");
    titleEl.className = "fw-bold text-break";
    titleEl.textContent = title;
    content.appendChild(titleEl);
  }

  if (items && items.length) {
    const ul = document.createElement("ul");
    ul.className = "list-unstyled ps-3 mb-0 text-break";
    for (const item of items) {
      const li = document.createElement("li");
      li.textContent = item;
      ul.appendChild(li);
    }
    content.appendChild(ul);
  } else if (message) {
    const msgEl = document.createElement("span");
    msgEl.className = "text-break";
    msgEl.textContent = message;
    content.appendChild(msgEl);
  }

  const closeBtn = document.createElement("i");
  closeBtn.className = "o_notification_close fa fa-times p-2 cursor-pointer";
  closeBtn.setAttribute("role", "img");
  closeBtn.setAttribute("aria-label", "Fermer");
  closeBtn.addEventListener("click", () => remove());

  row.appendChild(content);
  el.appendChild(row);
  el.appendChild(closeBtn);
  getContainer().appendChild(el);

  let timer = null;
  function remove() {
    if (timer) clearTimeout(timer);
    el.classList.add("o_notification_fade-enter");
    setTimeout(() => el.remove(), 200);
  }

  if (!sticky) {
    timer = setTimeout(remove, duration);
  }

  return remove;
}