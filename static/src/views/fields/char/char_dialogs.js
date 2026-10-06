import { CONFIG, getApiKey } from "../../../core/browser/session.js";
import { db } from "../../../core/orm_service.js";
import { notify } from "../../../core/notification_service.js";

const modelFieldCache = new Map();

function createDialog(title) {
  const backdrop = document.createElement("div");
  backdrop.className = "o_char_field_dialog_backdrop";
  backdrop.setAttribute("role", "presentation");
  backdrop.style.cssText =
    "position:fixed;inset:0;z-index:1080;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;padding:1rem";

  const dialog = document.createElement("section");
  dialog.className = "o_dialog o_char_field_dialog bg-white shadow rounded";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", title);
  dialog.style.cssText = "width:min(34rem,100%);max-height:min(80vh,45rem);display:flex;flex-direction:column";

  const header = document.createElement("header");
  header.className = "d-flex align-items-center justify-content-between border-bottom p-3";
  const heading = document.createElement("h2");
  heading.className = "h5 mb-0";
  heading.textContent = title;
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "btn btn-link text-muted p-0";
  closeButton.setAttribute("aria-label", "Fermer");
  closeButton.textContent = "×";
  header.append(heading, closeButton);

  const body = document.createElement("div");
  body.className = "p-3 overflow-auto";
  body.style.minHeight = "8rem";
  dialog.append(header, body);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  const close = () => {
    document.removeEventListener("keydown", onKeydown);
    backdrop.remove();
  };
  const onKeydown = (event) => {
    if (event.key === "Escape") close();
  };
  closeButton.addEventListener("click", close);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });
  document.addEventListener("keydown", onKeydown);

  return { backdrop, dialog, body, close };
}

function toFieldMap(fields) {
  if (Array.isArray(fields)) {
    return Object.fromEntries(fields.filter((field) => field?.name).map((field) => [field.name, field]));
  }
  return fields && typeof fields === "object" ? fields : {};
}

async function getModelFields(modelName, fieldsByModel = {}) {
  if (!modelName) return {};
  if (fieldsByModel?.[modelName]) return toFieldMap(fieldsByModel[modelName]);
  if (modelFieldCache.has(modelName)) return modelFieldCache.get(modelName);

  const cacheKey = `char-field-selector:${modelName}`;
  try {
    const cached = await db.cache_meta.get(cacheKey);
    if (cached?.value) {
      const fields = toFieldMap(cached.value);
      modelFieldCache.set(modelName, fields);
      if (!navigator.onLine) return fields;
    }
  } catch (error) {
    // IndexedDB may be unavailable in a restricted/private browsing context.
  }

  if (!navigator.onLine) return {};
  const apiKey = getApiKey();
  if (!apiKey) return {};

  const url = new URL(`${CONFIG.ODOO_BASE_URL}/offline_sync/model_fields`);
  url.searchParams.set("model", modelName);
  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new Error(`Impossible de charger les champs de ${modelName} (${response.status}).`);

  const data = await response.json();
  const fields = toFieldMap(data.fields || []);
  modelFieldCache.set(modelName, fields);
  try {
    await db.cache_meta.put({ key: cacheKey, value: fields });
  } catch (error) {
    // The fetched model fields remain usable for the current session.
  }
  return fields;
}

function readFormFieldValue(host, fieldName, fallbackValues = {}) {
  if (!fieldName) return "";
  const form = host.closest(".o_form_view");
  const row = form && Array.from(form.querySelectorAll("[data-field-row]")).find(
    (element) => element.dataset.fieldRow === fieldName
  );
  if (row) {
    const charHost = row.querySelector("[data-owl-char-field]");
    if (charHost && typeof charHost._owlCharValue === "string") return charHost._owlCharValue;
    const input = row.querySelector("input, select, textarea");
    if (input) return input.value;
  }
  return fallbackValues?.[fieldName] ?? "";
}

export async function openDynamicPlaceholderSelector({
  host,
  input,
  modelName,
  modelReferenceField,
  recordValues,
  fieldsByModel,
}) {
  const referencedModel = modelReferenceField
    ? readFormFieldValue(host, modelReferenceField, recordValues)
    : "";
  const rootModel = referencedModel || modelName;
  if (!rootModel) {
    notify({
      type: "danger",
      message: "Sélectionnez un modèle avant d'ouvrir le sélecteur de placeholder dynamique.",
    });
    return;
  }

  const rangeIndex = Number.isInteger(input.selectionStart) ? input.selectionStart : input.value.length;
  const popup = createDialog(`Placeholder dynamique — ${rootModel}`);
  const levels = [{ modelName: rootModel, path: [] }];

  function insertPlaceholder(path, defaultValue) {
    const before = input.value.slice(0, rangeIndex);
    const left = before.endsWith("#") ? before.slice(0, -1) : before;
    const suffix = input.value.slice(rangeIndex);
    let placeholder = `{{object.${path}`;
    if (defaultValue && defaultValue !== "") placeholder += ` or '''${defaultValue}'''`;
    placeholder += "}}";
    const nextValue = left + placeholder + suffix;
    input.value = nextValue;
    const cursor = left.length + placeholder.length;
    input.setSelectionRange(cursor, cursor);
    const EventCtor = input.ownerDocument.defaultView.Event;
    input.dispatchEvent(new EventCtor("input", { bubbles: true }));
    input.dispatchEvent(new EventCtor("change", { bubbles: true }));
    popup.close();
    input.focus();
  }

  function renderDefaultValueStep(path) {
    popup.body.replaceChildren();
    const description = document.createElement("p");
    description.className = "text-muted";
    description.textContent = `Valeur par défaut pour ${path} (facultative).`;
    const defaultInput = document.createElement("input");
    defaultInput.type = "text";
    defaultInput.className = "form-control";
    defaultInput.placeholder = "Texte utilisé si le champ n'a pas de valeur";
    defaultInput.setAttribute("aria-label", "Valeur par défaut");

    const footer = document.createElement("div");
    footer.className = "d-flex justify-content-between mt-3";
    const back = document.createElement("button");
    back.type = "button";
    back.className = "btn btn-secondary";
    back.textContent = "Retour aux champs";
    back.addEventListener("click", () => renderFieldSelector());
    const insert = document.createElement("button");
    insert.type = "button";
    insert.className = "btn btn-primary";
    insert.textContent = "Insérer";
    insert.addEventListener("click", () => insertPlaceholder(path, defaultInput.value));
    defaultInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        insertPlaceholder(path, defaultInput.value);
      }
    });
    footer.append(back, insert);
    popup.body.append(description, defaultInput, footer);
    defaultInput.focus();
  }

  async function renderFieldSelector() {
    const level = levels[levels.length - 1];
    popup.body.replaceChildren();

    const toolbar = document.createElement("div");
    toolbar.className = "d-flex gap-2 mb-2";
    if (levels.length > 1) {
      const back = document.createElement("button");
      back.type = "button";
      back.className = "btn btn-secondary";
      back.textContent = "←";
      back.setAttribute("aria-label", "Retour au modèle précédent");
      back.addEventListener("click", () => {
        levels.pop();
        renderFieldSelector();
      });
      toolbar.appendChild(back);
    }

    const search = document.createElement("input");
    search.type = "search";
    search.className = "form-control";
    search.placeholder = "Rechercher un champ";
    search.setAttribute("aria-label", "Rechercher un champ");
    toolbar.appendChild(search);
    const list = document.createElement("div");
    list.className = "list-group";
    list.setAttribute("role", "listbox");
    const loading = document.createElement("p");
    loading.className = "text-muted mt-2";
    loading.textContent = "Chargement des champs…";
    popup.body.append(toolbar, loading, list);

    let fields;
    try {
      fields = await getModelFields(level.modelName, fieldsByModel);
    } catch (error) {
      loading.textContent = error.message;
      return;
    }
    loading.remove();

    const candidates = Object.entries(fields)
      .filter(([, field]) => field && !["one2many", "boolean", "many2many"].includes(field.type))
      .filter(([, field]) => field.searchable !== false)
      .sort((a, b) => String(a[1].label || a[0]).localeCompare(String(b[1].label || b[0])));

    function updateList() {
      list.replaceChildren();
      const query = search.value.trim().toLocaleLowerCase();
      const filtered = candidates.filter(([name, field]) =>
        `${name} ${field.label || ""}`.toLocaleLowerCase().includes(query)
      );
      for (const [name, field] of filtered) {
        const row = document.createElement("div");
        row.className = "list-group-item d-flex align-items-center justify-content-between gap-2";
        const select = document.createElement("button");
        select.type = "button";
        select.className = "btn btn-link text-start flex-grow-1 p-0";
        select.textContent = `${field.label || name} (${name})`;
        select.addEventListener("click", () => {
          renderDefaultValueStep([...level.path, name].join("."));
        });
        row.appendChild(select);

        if (field.type === "many2one" && field.relation) {
          const follow = document.createElement("button");
          follow.type = "button";
          follow.className = "btn btn-secondary";
          follow.textContent = "›";
          follow.setAttribute("aria-label", `Parcourir les champs liés à ${field.label || name}`);
          follow.addEventListener("click", () => {
            levels.push({ modelName: field.relation, path: [...level.path, name] });
            renderFieldSelector();
          });
          row.appendChild(follow);
        }
        list.appendChild(row);
      }
      if (!filtered.length) {
        const empty = document.createElement("p");
        empty.className = "text-muted mt-2";
        empty.textContent = "Aucun champ compatible trouvé.";
        list.appendChild(empty);
      }
    }
    search.addEventListener("input", updateList);
    updateList();
    search.focus();
  }

  await renderFieldSelector();
}

export async function openCharTranslationDialog({
  model,
  recordId,
  fieldName,
  label,
  userLanguageValue,
}) {
  if (!recordId || String(recordId).startsWith("local:")) {
    notify({ type: "warning", message: "Enregistrez la fiche avant de modifier ses traductions." });
    return;
  }
  if (!navigator.onLine) {
    notify({ type: "warning", message: "La gestion des traductions nécessite une connexion à Odoo." });
    return;
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    notify({ type: "danger", message: "Session Odoo indisponible." });
    return;
  }

  const params = new URLSearchParams({ model, record_id: String(recordId), field_name: fieldName });
  let response;
  try {
    response = await fetch(`${CONFIG.ODOO_BASE_URL}/offline_sync/field_translations?${params}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (error) {
    notify({ type: "danger", message: "Impossible de charger les traductions depuis Odoo." });
    return;
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    notify({ type: "danger", message: payload.error || `Erreur de traduction (${response.status}).` });
    return;
  }

  const popup = createDialog(`Traduire : ${label || fieldName}`);
  const terms = Array.isArray(payload.translations) ? payload.translations : [];
  const languages = Array.isArray(payload.languages) ? payload.languages : [];
  const languageNames = new Map(languages.map(([code, name]) => [code, name]));
  const showSource = !!payload.context?.translation_show_source;
  const isText = payload.context?.translation_type === "text";
  const userLang = payload.user_lang;

  if (!terms.length) {
    const empty = document.createElement("p");
    empty.className = "text-muted";
    empty.textContent = "Aucune langue traduisible n'est installée.";
    popup.body.appendChild(empty);
  }

  const changes = new Map();
  terms
    .slice()
    .sort((a, b) => String(languageNames.get(a.lang) || a.lang).localeCompare(String(languageNames.get(b.lang) || b.lang)))
    .forEach((term) => {
      const line = document.createElement("div");
      line.className = "mb-3";
      const languageLabel = document.createElement("label");
      languageLabel.className = "form-label fw-bold";
      languageLabel.textContent = languageNames.get(term.lang) || term.lang;
      const source = document.createElement("div");
      source.className = "text-muted small mb-1";
      source.textContent = showSource ? (term.source || "") : "";
      const input = document.createElement(isText ? "textarea" : "input");
      if (!isText) input.type = "text";
      input.className = "form-control";
      input.value = term.lang === userLang && !showSource
        ? (userLanguageValue || "")
        : (term.value || "");
      input.setAttribute("aria-label", `Traduction ${languageNames.get(term.lang) || term.lang}`);
      const displayValue = input.value;
      input.addEventListener("input", () => changes.set(term.lang, { term, displayValue, value: input.value }));
      line.append(languageLabel, source, input);
      popup.body.appendChild(line);
    });

  const footer = document.createElement("div");
  footer.className = "d-flex justify-content-end gap-2 border-top pt-3 mt-3";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "btn btn-secondary";
  cancel.textContent = "Annuler";
  cancel.addEventListener("click", popup.close);
  const save = document.createElement("button");
  save.type = "button";
  save.className = "btn btn-primary";
  save.textContent = "Enregistrer";
  save.addEventListener("click", async () => {
    const translatedValues = {};
    for (const { term, displayValue, value } of changes.values()) {
      if (displayValue === value) continue;
      if (showSource) {
        if (!translatedValues[term.lang]) translatedValues[term.lang] = {};
        const oldValue = term.value || term.source;
        translatedValues[term.lang][oldValue] = value || term.source;
      } else {
        translatedValues[term.lang] = value || false;
      }
    }
    if (!Object.keys(translatedValues).length) {
      popup.close();
      return;
    }

    save.disabled = true;
    try {
      const saveResponse = await fetch(`${CONFIG.ODOO_BASE_URL}/offline_sync/field_translations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, record_id: recordId, field_name: fieldName, translations: translatedValues }),
      });
      const savePayload = await saveResponse.json().catch(() => ({}));
      if (!saveResponse.ok) throw new Error(savePayload.error || `Erreur de traduction (${saveResponse.status}).`);
      popup.close();
      notify({ type: "success", message: "Traductions enregistrées dans Odoo." });
    } catch (error) {
      save.disabled = false;
      notify({ type: "danger", message: error.message || "Échec de l'enregistrement des traductions." });
    }
  });
  footer.append(cancel, save);
  popup.body.appendChild(footer);
}
