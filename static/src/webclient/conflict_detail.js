/**
 * webclient/conflict_detail.js
 * Page dédiée à la résolution complète d'un conflit — ouverte depuis
 * conflict_panel.js (clic sur une entrée de la liste). Affiche chaque
 * champ en conflit avec "Votre modification" / "Modification serveur"
 * côte à côte, et applique la résolution à l'ENSEMBLE de l'entrée
 * sync_queue (voir sync_queue.py::resolve_conflict — pas de résolution
 * champ par champ, une action = une décision).
 */

import { resolveModelDisplayInfo } from "../core/model_display.js";
import { getCachedRecord } from "../core/record_cache.js";
import { getReferenceRecordsSmart } from "../core/name_service.js";
import { db } from "../core/orm_service.js";
import { registry } from "../core/registry.js";
import { getApiKey, CONFIG } from "../core/browser/session.js";
import { bus } from "../core/bus/bus_service.js";
import { getCachedConflicts, resolveConflict } from "../core/network/rpc_service.js";

function formatFieldLabel(fieldName) {
  const lineMatch = fieldName.match(/^(.+)\[(\d+)\]\.(.+)$/);
  if (lineMatch) return `${lineMatch[1]} (ligne #${lineMatch[2]}) — ${lineMatch[3]}`;
  const simpleMatch = fieldName.match(/^(.+)\[(\d+)\]$/);
  if (simpleMatch) return `${simpleMatch[1]} (ligne #${simpleMatch[2]})`;
  return fieldName;
}

async function resolveConflictValues(
  modelName,
  fieldName,
  localValue,
  serverValue,
  apiKey,
  baseUrl
) {
  const fieldInfo = await getFieldInfo(modelName, fieldName);

  if (
    !fieldInfo ||
    !(
      fieldInfo.type === "many2one" ||
      fieldInfo.type === "many2many"
    ) ||
    !fieldInfo.relation
  ) {
    return {
      local: formatConflictValue(localValue),
      server: formatConflictValue(serverValue),
    };
  }

  const records = await getReferenceRecordsSmart(
    fieldInfo.relation,
    apiKey,
    baseUrl
  );

  const resolveOne = (value) => {
    if (value === false || value === null || value === undefined) {
      return "(vide)";
    }

    if (fieldInfo.type === "many2one") {
      const record = records.find(
        (r) => String(r.id) === String(value)
      );

      return record?.display_name || `#${value}`;
    }

    if (fieldInfo.type === "many2many") {
      if (!Array.isArray(value)) {
        return String(value);
      }

      return value
        .map((id) => {
          const record = records.find(
            (r) => String(r.id) === String(id)
          );

          return record?.display_name || `#${id}`;
        })
        .join(", ");
    }

    return formatConflictValue(value);
  };

  return {
    local: resolveOne(localValue),
    server: resolveOne(serverValue),
  };
}

async function getFieldInfo(modelName, fieldName) {
  const manifests = await db.module_manifests.toArray();
  for (const manifest of manifests) {
    const modelFields = manifest.fields?.[modelName];
    if (modelFields?.[fieldName]) {
      return modelFields[fieldName];
    }
  }
  return null;
}

function formatConflictValue(value) {
  if (value === false || value === null || value === undefined) return "(vide)";
  if (Array.isArray(value)) {
    if (value.length === 2 && typeof value[1] === "string") return value[1];
    return JSON.stringify(value);
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function mountConflictDetail(container, params, env) {
  const { localUuid } = params;

  container.innerHTML = "";
  container.classList.add("p-3");

  const backLink = document.createElement("a");
  backLink.href = "#";
  backLink.className = "d-inline-block mb-3 text-muted small";
  backLink.textContent = "← Retour";
  backLink.addEventListener("click", (e) => {
    e.preventDefault();
    env.goBack();
  });
  container.appendChild(backLink);

  const content = document.createElement("div");
  container.appendChild(content);

  async function render() {
    content.innerHTML = "";

    const conflicts = await getCachedConflicts();
    const entry = conflicts.find((c) => c.local_uuid === localUuid);

    let payload = {};
    try {
      payload =
        typeof entry.payload === "string"
          ? JSON.parse(entry.payload)
          : (entry.payload || {});
    } catch (err) {
      console.error("[ConflictDetail] Payload JSON invalide:", entry.payload, err);
    }

    const recordId = payload.id;

    if (!entry) {
      content.innerHTML = `<p class="text-muted">Ce conflit n'existe plus (déjà résolu ailleurs, ou supprimé).</p>`;
      return;
    }

    console.log("[ConflictDetail] entry complet =", entry);
    console.log("[ConflictDetail] model_name =", entry.model_name);
    console.log("[ConflictDetail] payload =", payload);
    console.log("[ConflictDetail] recordId =", recordId);

    const cachedRecord = recordId != null
      ? await getCachedRecord(entry.model_name, recordId)
      : null;

    const { appLabel, documentTypeLabel } = await resolveModelDisplayInfo(entry.model_name, cachedRecord);

    const recordRef = cachedRecord?.name || (recordId != null ? `#${recordId}` : "Enregistrement");
    const titleParts = [
      "Conflict",
      appLabel,
      documentTypeLabel,
      recordRef,
    ].filter(Boolean); 

    const title = document.createElement("h5");
    title.textContent = titleParts.join(" - ");
    content.appendChild(title);

    const subtitle = document.createElement("p");
    subtitle.className = "text-muted small";
    subtitle.textContent = `Créé le ${entry.created_at || "—"}`;
    content.appendChild(subtitle);

    for (const fieldConflict of entry.conflicts) {
      const values = await resolveConflictValues(
        entry.model_name,
        fieldConflict.field,
        fieldConflict.local_value,
        fieldConflict.server_value,
        getApiKey(),
        CONFIG.ODOO_BASE_URL
      );

      const compareRow = document.createElement("div");
      compareRow.className = "mb-3";

      compareRow.innerHTML = `
        <div class="fw-semibold mb-2">
          ${formatFieldLabel(fieldConflict.field)}
        </div>

        <div class="row g-2">

          <!-- Votre modification -->
          <div class="col-md-6">
            <div class="text-muted small">
              Votre modification
            </div>

            <div>
              ${values.local}
            </div>

            ${
              entry.reference_write_date
                ? `
                  <div class="text-muted small mt-1">
                    Modifié le ${entry.reference_write_date}
                  </div>
                `
                : ""
            }
          </div>

          <!-- Modification serveur -->
          <div class="col-md-6">
            <div class="text-muted small">
              Modification serveur
            </div>

            <div>
              ${values.server}
            </div>

            ${
              fieldConflict.server_write_date
                ? `
                  <div class="text-muted small mt-1">
                    Modifié le ${fieldConflict.server_write_date}
                  </div>
                `
                : ""
            }
          </div>

        </div>
      `;

      content.appendChild(compareRow);
    }


    const actions = document.createElement("div");
    actions.className = "d-flex gap-2 mt-3";

    const keepLocalBtn = document.createElement("button");
    keepLocalBtn.type = "button";
    keepLocalBtn.className = "btn btn-primary flex-grow-1";
    keepLocalBtn.textContent = "Garder ma modification";

    const keepServerBtn = document.createElement("button");
    keepServerBtn.type = "button";
    keepServerBtn.className = "btn btn-outline-secondary flex-grow-1";
    keepServerBtn.textContent = "Garder celle du serveur";

    const handleResolve = async (resolution) => {
      keepLocalBtn.disabled = true;
      keepServerBtn.disabled = true;
      try {
        await resolveConflict(entry.local_uuid, resolution, getApiKey(), CONFIG.ODOO_BASE_URL);
        bus.trigger("sync:updated");
        env.goBack();
      } catch (err) {
        console.error("Résolution du conflit échouée:", err);
        alert("Impossible de résoudre ce conflit pour le moment : " + err.message);
        keepLocalBtn.disabled = false;
        keepServerBtn.disabled = false;
      }
    };

    keepLocalBtn.addEventListener("click", () => handleResolve("local"));
    keepServerBtn.addEventListener("click", () => handleResolve("server"));

    actions.appendChild(keepLocalBtn);
    actions.appendChild(keepServerBtn);
    content.appendChild(actions);
  }

  render();

  return {
    destroy() {},
  };
}

registry.category("actions").add("conflict_detail", { mount: mountConflictDetail });

export { mountConflictDetail };