/**
 * views/form/form_controller.js
 * ================================
 * Manages the complete load/render/save cycle for a single record, with
 * an offline-first sync queue.
 */

import { bus } from "../../core/bus/bus_service.js";
import { CONFIG, getApiKey } from "../../core/browser/session.js";
import { getModuleManifest, resolveModelViews } from "../view_service.js";
import { getReferenceRecordsSmart } from "../../core/name_service.js";
import { getRecordSmart, getCachedRecord } from "../../core/record_cache.js";
import { getSecurityInfo } from "../../core/user_service.js";
import { renderFormView } from "./form_renderer.js";
import { destroyCharFields } from "../fields/char/char_field.js";
import { attachLiveBusinessRules, attachLiveOnchange } from "../../model/relational_model/relational_model.js";
import { constraintsRegistry } from "../../model/relational_model/business_rules_registry.js";
import { collectFormData } from "./form_serializer.js";
import {
  queueAction,
  queueMethodCall,
  syncPendingActions,
  amendPendingCreate,
  getSyncQueueEntry,
} from "../../core/network/rpc_service.js";
import { buildControlPanel } from "../../search/control_panel/control_panel.js";
import { notify } from "../../core/notification_service.js";

/**
 * Mounts a form into the container and returns a cleanup
 * (destroy) function. Called by views/view.js.
 */
export async function mountFormController(container, params, env) {
  const { module, model, id, isNew, actionId, listLabel } = params;

  if (!module || !model) {
    console.warn("[form_controller] descripteur incomplet, retour à l'accueil :", params);
    env.doAction("home_menu", { replace: true, clearStack: true });
    return () => {};
  }

  const apiKey = getApiKey();

  const isLocalId = typeof id === "string" && id.startsWith("local:");
  let currentRecordId = id && !isLocalId ? parseInt(id, 10) : null;
  // Fiche créée hors ligne, pas encore synchronisée : on la retrouve
  // dans la file (sync_queue) via son UUID local plutôt que de la
  // traiter comme un enregistrement serveur classique.
  let pendingCreateUuid = isLocalId ? id.slice(6) : null;
  let currentReferenceWriteDate = null;
  let currentReferenceValues = {};
  let currentContainer = null;
  let currentFieldsInfo = null;
  let cleanupRules = () => {};
  let cleanupOnchange = () => {};

  const onchangeHelpers = { getReferenceRecordsSmart, getRecordSmart, apiKey, baseUrl: CONFIG.ODOO_BASE_URL };

  // NEW — promoted to closure variables (previously: local to the try
  // block) so that saveRecord() can rebuild the form after a
  // successful write, without relying on a full view reload.
  let archXml = null;
  let currentSecurityContext = null;

  const cp = buildControlPanel({ withRecordStatusIcons: true });
  container.appendChild(cp.el);

  if (listLabel) {
    cp.breadcrumbListItem.classList.remove("d-none");
    cp.breadcrumbListLink.textContent = listLabel;
    cp.breadcrumbListLink.addEventListener("click", (e) => {
      e.preventDefault();
      env.goBack();
    });
  }

  if (navigator.onLine) {
    syncPendingActions()
      .catch((err) => console.warn("Rattrapage synchro échoué:", err))
      .finally(() => bus.trigger("sync:updated"));
  }

  // Notification de chargement persistante, fermée dès que le formulaire est prêt
  const closeLoading = notify({
    type: "info",
    message: "Loading...",
  });


  try {
    const manifest = await getModuleManifest(module, apiKey, CONFIG.ODOO_BASE_URL);
    const modelViews = resolveModelViews(manifest, model, actionId);
    const fieldsInfo = manifest.fields[model];

    if (!modelViews || !modelViews.form || !fieldsInfo) {
      closeLoading();
      notify({
        type: "danger",
        title: "Formulaire indisponible",
        message: `Aucune vue formulaire disponible pour "${model}".`,
      });

      return () => {};
    }

    // Pass model context to OWL char widgets without polluting Object.entries()
    // used by form serialization.
    Object.defineProperties(fieldsInfo, {
      _modelName: { value: model, configurable: true },
      _allModels: { value: manifest.fields || {}, configurable: true },
    });

    archXml = modelViews.form.arch;

    const relationsToPreload = new Set();
    for (const finfo of Object.values(fieldsInfo)) {
      if ((finfo.type === "many2one" || finfo.type === "many2many") && finfo.relation) {
        relationsToPreload.add(finfo.relation);
      }
      if (finfo.type === "one2many" && finfo.sub_fields) {
        for (const subInfo of Object.values(finfo.sub_fields)) {
          if ((subInfo.type === "many2one" || subInfo.type === "many2many") && subInfo.relation) {
            relationsToPreload.add(subInfo.relation);
          }
        }
      }
    }
    for (const relModel of relationsToPreload) {
      await getReferenceRecordsSmart(relModel, apiKey, CONFIG.ODOO_BASE_URL);
    }

    let initialValues = {};
    if (currentRecordId) {
      initialValues = await getRecordSmart(model, currentRecordId, apiKey, CONFIG.ODOO_BASE_URL);
      currentReferenceWriteDate = initialValues.__reference_write_date__ || null;
      const { __reference_write_date__, ...cleanValues } = initialValues;
      currentReferenceValues = cleanValues;
    } else if (pendingCreateUuid) {
      // Pas d'appel réseau ici : cet ID n'existe que localement.
      initialValues = (await getCachedRecord(model, id)) || {};
    }

    const securityInfo = await getSecurityInfo(model);
    currentSecurityContext = securityInfo || { is_admin: false };

    const formEl = renderFormView(archXml, fieldsInfo, initialValues, currentSecurityContext, onObjectButtonClick);
    formEl.dataset.model = model;
    container.appendChild(formEl);
    cleanupRules = attachLiveBusinessRules(archXml, formEl, fieldsInfo);
    cleanupOnchange = attachLiveOnchange(model, formEl, fieldsInfo, onchangeHelpers);

    currentContainer = formEl;
    currentFieldsInfo = fieldsInfo;

    cp.cloudBtn.addEventListener("click", saveRecord);
    cp.undoBtn.addEventListener("click", () => {
      env.doAction({ tag: "form_view", module, model, id: currentRecordId, actionId, listLabel }, { replace: true });
    });

    closeLoading();
    if (!navigator.onLine) {
      notify({
        type: "info",
        message: "Mode hors-ligne — données mises en cache.",
      });
    }


    const recordLabel = (currentRecordId || pendingCreateUuid)
      ? initialValues.name || `#${currentRecordId || pendingCreateUuid}`
      : "Nouveau";
    cp.breadcrumbCurrent.textContent = recordLabel;
  } catch (err) {
    closeLoading();
    console.error(err);
    notify({
      type: "danger",
      title: "Erreur de chargement",
      message: err.message,
    });

  }

  /**
   * NEW — rebuilds the form from fresh server data.
   * Necessary after a successful write: one2many lines
   * created via this write receive a real server-side ID that
   * no sync response otherwise propagates back to the client
   * (confirmed by sync_queue.py::_execute, which returns only
   * the record_id for the root record, never the IDs of linked
   * lines). Without this refresh, a synchronized one2many line
   * remains with _recordId=null indefinitely and would be
   * recreated as a duplicate upon the next write involving
   * that same line.
   */
  async function refreshFormFromServer() {
    if (!currentRecordId || !archXml || !currentFieldsInfo) return;

    const freshRecord = await getRecordSmart(model, currentRecordId, getApiKey(), CONFIG.ODOO_BASE_URL);
    currentReferenceWriteDate = freshRecord.__reference_write_date__ || null;
    const { __reference_write_date__, ...cleanValues } = freshRecord;
    currentReferenceValues = cleanValues;

    cleanupRules();
    cleanupOnchange();
    destroyCharFields();

    const newFormEl = renderFormView(archXml, currentFieldsInfo, freshRecord, currentSecurityContext, onObjectButtonClick);
    newFormEl.dataset.model = model;
    currentContainer.replaceWith(newFormEl);
    currentContainer = newFormEl;
    cleanupRules = attachLiveBusinessRules(archXml, newFormEl, currentFieldsInfo);
    cleanupOnchange = attachLiveOnchange(model, newFormEl, currentFieldsInfo, onchangeHelpers);

    cp.breadcrumbCurrent.textContent = freshRecord.name || `#${currentRecordId}`;
  }

  /**
   * NEW — handles a click on a type="object" header button (e.g.
   * action_confirm, action_cancel, action_lock...). Follows the exact
   * same pattern already used by saveRecord(): always queue locally
   * first, then flush immediately if online. This keeps a single,
   * consistent offline-first code path instead of a separate "direct
   * online RPC" branch.
   *
   * Generic by design: methodName is whatever the arch XML declared as
   * button name="..." — no method name is hardcoded here.
   *
   * Known limitations (intentionally deferred, not silently ignored):
   * - The button's "context" attribute (e.g. context="{'validate_analytic': True}")
   *   is not evaluated/forwarded yet — args/kwargs are sent empty.
   * - type="action" buttons are out of scope for this iteration
   *   (see status_bar_buttons/status_bar_buttons.js, unchanged behavior for them).
   */
  async function onObjectButtonClick(methodName) {
    if (!currentRecordId) {
      notify({
        type: "warning",
        message: "Impossible d'exécuter cette action avant l'enregistrement de la fiche.",
      });
      return;
    }

    try {
      const localUuid = await queueMethodCall(model, currentRecordId, methodName);
      bus.trigger("sync:updated");

      // Hors-ligne : on annonce uniquement la mise en file.
      if (!navigator.onLine) {
        notify({
          type: "info",
          message: "Action enregistrée localement — sera synchronisée dès que possible.",
        });
        return;
      }

      // En ligne : on tente le flush et on ne notifie qu'UNE fois,
      // selon le résultat réel.
      const result = await syncPendingActions();

      // Cas 1 — la méthode a renvoyé une action non rejouable : c'est
      // le message le plus important, il prime sur le "succès".
      const pendingInfo = result.manualActions && result.manualActions[localUuid];
      if (pendingInfo) {
        notify({
          type: "warning",
          title: "Action incomplète",
          message:
            "L'action a été exécutée, mais nécessite une étape supplémentaire dans Odoo" +
            (pendingInfo.name ? ` (${pendingInfo.name})` : "") +
            " — à compléter une fois connecté.",
        });
        try {
          await refreshFormFromServer();
        } catch (err) {
          console.warn("Rafraîchissement post-action échoué:", err);
        }
        bus.trigger("sync:updated");
        return;
      }

      // Cas 2 — synchronisation réussie et action complète.
      if (result.synced > 0) {
        notify({
          type: "success",
          message: "Action synchronisée avec Odoo.",
        });
        try {
          await refreshFormFromServer();
        } catch (err) {
          console.warn("Rafraîchissement post-action échoué:", err);
        }
        bus.trigger("sync:updated");
        return;
      }

      // Cas 3 — le flush n'a rien synchronisé (conflit, erreur, ou
      // file bloquée) : l'action reste en attente locale.
      if (result.hasConflict) {
        notify({
          type: "warning",
          title: "Conflit détecté",
          message:
            "Ce document a été modifié par quelqu'un d'autre. " +
            "Ouvrez le panneau de synchronisation pour choisir quelle version garder.",
        });
      } else if (result.hasError) {
        notify({
          type: "danger",
          title: "Erreur de synchronisation",
          message: "L'action est enregistrée localement mais n'a pas pu être synchronisée.",
        });
      } else {
        notify({
          type: "info",
          message: "Action enregistrée localement — sera synchronisée dès que possible.",
        });
      }

      bus.trigger("sync:updated");
    } catch (err) {
      console.error(err);
      notify({
        type: "danger",
        title: "Erreur",
        message: "Erreur lors de l'exécution de l'action : " + err.message,
      });
    }
  }

  async function saveRecord() {
    if (!currentContainer || !currentFieldsInfo) return;
    const formData = collectFormData(currentContainer, currentFieldsInfo);

    // Filet local optionnel : ne remplace jamais la vraie contrainte Python
    // côté serveur, sert juste à éviter un aller-retour inutile quand la
    // règle est connue et enregistrée pour ce modèle.
    const checkConstraint = constraintsRegistry.get(model, null);
    if (checkConstraint) {
      const errorMessage = checkConstraint(formData);
      if (errorMessage) {
        notify({
          type: "warning",
          message: errorMessage,
        });
        return;
      }
    }

    try {
      let localUuid;

      if (currentRecordId) {
        formData.id = currentRecordId;
        localUuid = await queueAction(model, "write", formData, "generic", currentReferenceWriteDate, currentReferenceValues);
      } else if (pendingCreateUuid) {
        const amended = await amendPendingCreate(pendingCreateUuid, formData);
        if (amended) {
          localUuid = pendingCreateUuid;
        } else {
          const entry = await getSyncQueueEntry(pendingCreateUuid);
          if (entry && entry.odoo_record_id) {
            currentRecordId = entry.odoo_record_id;
            formData.id = currentRecordId;
            localUuid = await queueAction(model, "write", formData, "generic", currentReferenceWriteDate, currentReferenceValues);
            pendingCreateUuid = null;
          } else {
            localUuid = await queueAction(model, "create", formData, "generic", currentReferenceWriteDate, currentReferenceValues);
            pendingCreateUuid = localUuid;
          }
        }
      } else {
        localUuid = await queueAction(model, "create", formData, "generic", currentReferenceWriteDate, currentReferenceValues);
        pendingCreateUuid = localUuid;
      }

      bus.trigger("sync:updated");

      if (navigator.onLine) {
        const result = await syncPendingActions();
        const wasCreate = !!(result.createdIds && result.createdIds[localUuid]);

        if (wasCreate) {
          currentRecordId = result.createdIds[localUuid];
          pendingCreateUuid = null;
        }

        if (result.synced > 0) {
          notify({
            type: "success",
            message: "Enregistré et synchronisé avec Odoo",
          });
          // NEW: in both cases (create OR write), we reload
          // the complete record from the server — for a create,
          // this also retrieves the IDs of one2many lines created at the
          // same time as the root record; for a write, it is the
          // only way to obtain these IDs (see refreshFormFromServer).
          try {
            await refreshFormFromServer();
          } catch (err) {
            console.warn("Rafraîchissement post-synchronisation échoué:", err);
          }
        } else if (result.hasConflict) {
          // NEW: distinct from a technical error — the write was
          // intentionally refused because the record changed elsewhere
          // in the meantime. Resolution happens in the sync panel, not
          // here (see conflict_panel.js).
          notify({
            type: "warning",
            message:
              "Conflit détecté : ce document a été modifié par quelqu'un d'autre. " +
              "Ouvrez le panneau de synchronisation pour choisir quelle version garder.",
          });
        } else if (result.hasError) {
          notify({
            type: "danger",
            title: "Erreur de synchronisation",
            message: "Erreur lors de la synchronisation — voir le panneau de synchronisation.",
          });
        }
        bus.trigger("sync:updated");
      }
    } catch (err) {
      console.error(err);
      notify({
        type: "danger",
        title: "Erreur d'enregistrement",
        message: "Erreur lors de l'enregistrement : " + err.message,
      });
    }
  }

  return () => {
    cleanupRules();
    cleanupOnchange();
    destroyCharFields();
  };
}