/**
 * webclient/assistant/assistant_panel.js
 * ========================================
 * UI de l'assistant : un bouton dans le systray de la navbar + un
 * panneau avec une zone de saisie et un historique de conversation.
 * Suit exactement les mêmes conventions que sync_status_panel.js
 * (DOM natif, pas de framework de composant, createDropdown partagé).
 *
 * Contrairement à sync_status_panel.js, ce panneau construit lui-même
 * son propre balisage (au lieu de dépendre d'éléments déjà présents
 * dans NAVBAR_TEMPLATE) pour limiter les modifications manuelles
 * nécessaires dans webclient.js à une seule ligne d'intégration.
 */
import { createDropdown } from "../../core/dropdown/dropdown.js";
import { handleUserQuery } from "./assistant_router.js";

function buildMarkup() {
  const wrapper = document.createElement("div");
  wrapper.className = "o-dropdown dropdown o_assistant_menu o-dropdown--no-caret";
  wrapper.innerHTML = `
    <button id="assistant-btn" type="button" class="dropdown-toggle" tabindex="0"
            aria-expanded="false" title="Assistant">
      <i class="fa fa-lg fa-magic" role="img" aria-label="Assistant"></i>
    </button>

    <div id="assistant-dropdown"
        class="dropdown-menu dropdown-menu-end p-0 o_assistant_dropdown"
        style="width: 360px; max-height: 480px;">

      <div class="px-3 py-2 border-bottom">
        <strong class="small">Assistant hors ligne</strong>
      </div>

      <div id="assistant-log"
          class="flex-grow-1 p-2"
          style="overflow-y:auto; max-height:340px;">
      </div>

      <form id="assistant-form" class="d-flex gap-1 p-2 border-top">
        <input id="assistant-input"
              type="text"
              class="form-control form-control-sm"
              placeholder="Pose une question..."
              autocomplete="off" />

        <button type="submit" class="btn btn-sm btn-primary">
          <i class="fa fa-arrow-up"></i>
        </button>
      </form>

    </div>
  `;
  return wrapper;
}

function appendMessage(logEl, { role, text }) {
  const bubble = document.createElement("div");
  bubble.className = `small mb-2 p-2 rounded ${
    role === "user" ? "bg-primary text-white ms-4" : "bg-light me-4"
  }`;
  bubble.style.whiteSpace = "pre-line";
  bubble.textContent = text;
  logEl.appendChild(bubble);
  logEl.scrollTop = logEl.scrollHeight;
}

/**
 * Formate les données structurées renvoyées par un handler en texte
 * lisible, quand on veut afficher plus que le simple résumé ("text").
 * Volontairement minimal — l'étape suivante naturelle serait de rendre
 * ces résultats avec les composants de liste/fiche déjà existants
 * plutôt qu'en texte brut (voir "Limites et pistes" du mémoire).
 */
function appendResultPreview(logEl, result) {
  if (!result.data) return;
  if (Array.isArray(result.data) && result.data.length > 0) {
    const list = document.createElement("ul");
    list.className = "small me-4 ps-3";
    result.data.slice(0, 5).forEach((record) => {
      const li = document.createElement("li");
      li.textContent = record.display_name || record.name || `#${record.id}`;
      list.appendChild(li);
    });
    logEl.appendChild(list);
  }
}

export function mountAssistantPanel(navbarRoot) {
  const systray = navbarRoot.querySelector(".o_menu_systray");
  if (!systray) {
    console.warn("[assistant_panel] .o_menu_systray introuvable, panneau non monté.");
    return { destroy() {} };
  }

  const wrapper = buildMarkup();
  systray.prepend(wrapper);

  const btn = wrapper.querySelector("#assistant-btn");
  const dropdown = wrapper.querySelector("#assistant-dropdown");
  const logEl = wrapper.querySelector("#assistant-log");
  const form = wrapper.querySelector("#assistant-form");
  const input = wrapper.querySelector("#assistant-input");

  if (logEl.children.length === 0) {
    appendMessage(logEl, {
      role: "assistant",
      text: "Bonjour ! Tu peux me demander par exemple :\n\"montre les commandes en attente de...\"\n\"où en est la synchronisation ?\"",
    });
  }

  async function onSubmit(e) {
    e.preventDefault();
    const query = input.value.trim();
    if (!query) return;

    appendMessage(logEl, { role: "user", text: query });
    input.value = "";
    input.disabled = true;

    try {
      const result = await handleUserQuery(query);
      appendMessage(logEl, { role: "assistant", text: result.text });
      appendResultPreview(logEl, result);
    } catch (err) {
      console.error("[assistant_panel] erreur", err);
      appendMessage(logEl, { role: "assistant", text: "Une erreur est survenue." });
    } finally {
      input.disabled = false;
      input.focus();
    }
  }

  form.addEventListener("submit", onSubmit);

  const panel = createDropdown(btn, dropdown, {
    onOpen: () => input.focus(),
  });

  return {
    destroy() {
      form.removeEventListener("submit", onSubmit);
      panel.destroy();
      wrapper.remove();
    },
  };
}
