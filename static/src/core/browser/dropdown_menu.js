/**
 * core/browser/dropdown_menu.js
 * Factory unique pour tous les dropdowns de la navbar (menu utilisateur,
 * statut de synchronisation, etc.) — même principe que le registre
 * "systray" d'Odoo : un seul mécanisme de montage/comportement partagé,
 * chaque panel ne fournissant que son propre contenu (render).
 *
 * Gère : ouverture/fermeture, positionnement dynamique via Popper.js
 * (@popperjs/core v2.11.2, vendored — static/lib/popper.min.js, chargé
 * en global dans index.html), fermeture des autres dropdowns ouverts,
 * fermeture au clic extérieur.
 */

const registeredDropdowns = [];

function closeAllExcept(exceptEl) {
  registeredDropdowns.forEach((d) => {
    if (d.dropdownEl !== exceptEl && d.dropdownEl.classList.contains("show")) {
      d.close();
    }
  });
}

/**
 * @param {HTMLElement} btnEl - le bouton qui ouvre/ferme le dropdown
 * @param {HTMLElement} dropdownEl - l'élément .dropdown-menu à positionner
 * @param {Object} handlers
 * @param {Function} [handlers.onOpen] - appelé à chaque ouverture (ex: pour re-render le contenu)
 * @param {Object} [popperOptions] - options Popper additionnelles (placement, etc.)
 */
export function createDropdown(btnEl, dropdownEl, { onOpen } = {}, popperOptions = {}) {
  let popperInstance = null;

  function open() {
    closeAllExcept(dropdownEl);
    if (onOpen) onOpen();
    dropdownEl.classList.add("show");
    popperInstance = window.Popper.createPopper(btnEl, dropdownEl, {
      placement: "bottom-end",
      modifiers: [
        { name: "offset", options: { offset: [0, 4] } },
        { name: "preventOverflow", options: { padding: 8 } },
        { name: "flip", options: { fallbackPlacements: ["top-end", "bottom-start"] } },
      ],
      ...popperOptions,
    });
  }

  function close() {
    dropdownEl.classList.remove("show");
    if (popperInstance) {
      popperInstance.destroy();
      popperInstance = null;
    }
  }

  function toggle(e) {
    e.stopPropagation();
    if (dropdownEl.classList.contains("show")) {
      close();
    } else {
      open();
    }
  }

  function stopPropagation(e) {
    e.stopPropagation();
  }

  btnEl.addEventListener("click", toggle);
  dropdownEl.addEventListener("click", stopPropagation);

  const entry = { dropdownEl, close };
  registeredDropdowns.push(entry);

  return {
    open,
    close,
    destroy() {
      close();
      btnEl.removeEventListener("click", toggle);
      dropdownEl.removeEventListener("click", stopPropagation);
      const idx = registeredDropdowns.indexOf(entry);
      if (idx !== -1) registeredDropdowns.splice(idx, 1);
    },
  };
}

// Fermeture globale au clic en dehors de n'importe quel dropdown enregistré —
// un seul listener partagé, pas un par panel.
document.addEventListener("click", () => closeAllExcept(null));