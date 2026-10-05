/**
 * model/relational_model/relational_model.js.
 * Hooks up the live re-evaluation of dynamic attributes (readonly/
 * required) for the entire form: on every input event, the current
 * values are read and the rules for each relevant <field> are re-applied.
 *
 * Évalué aussi, à chaque événement input/change :
 *  - les computes de champ du registre "offline_field_compute"
 *    (clé "model:field") — écrit le résultat dans le DOM si le champ
 *    existe dans la vue ;
 *  - les onchange du registre "offline_onchange" (voir attachLiveOnchange).
 */

import { notify } from "../../core/notification_service.js";
import { applyDynamicAttrs, resetDynamicAttrs } from "./dynamic_field_attrs.js";
import { collectFormData } from "../../views/form/form_serializer.js";
import { onchangeRegistry, fieldComputeRegistry } from "./business_rules_registry.js";

/**
 * Écrit la valeur d'un compute de champ dans le DOM du formulaire.
 * Ne touche le DOM que si la valeur a réellement changé (évite de
 * ré-enclencher la boucle input/change à chaque réévaluation).
 *
 * @returns {boolean} true si la valeur a été appliquée (changement effectif)
 */
function writeFieldValue(containerEl, fieldName, finfo, value) {
  if (value === undefined) return false;
  const rowEl = containerEl.querySelector(`[data-field-row="${fieldName}"]`);
  if (!rowEl) return false;

  const setScalar = (input, v) => {
    const normalized = v === null || v === false ? "" : v;
    if (input.type === "checkbox") {
      if (input.checked !== !!normalized) {
        input.checked = !!normalized;
        return true;
      }
      return false;
    }
    const asText = typeof normalized === "number" ? String(normalized) : String(normalized);
    if (input.value !== asText) {
      input.value = asText;
      return true;
    }
    return false;
  };

  if (finfo && finfo.type === "many2one" && value && typeof value === "object") {
    // Many2one : deux inputs à synchroniser (texte affiché + id caché)
    const hiddenId = rowEl.querySelector(`input[name="${fieldName}_id"]`);
    const visibleInput = rowEl.querySelector(`input#field-${fieldName}`);
    let changed = false;
    if (hiddenId && hiddenId.value !== String(value.id ?? "")) {
      hiddenId.value = value.id ?? "";
      changed = true;
    }
    if (visibleInput && visibleInput.value !== (value.display_name ?? "")) {
      visibleInput.value = value.display_name ?? "";
      changed = true;
    }
    return changed;
  }

  if (finfo && finfo.type === "many2one") {
    // many2one ramené à false / id brut
    const hiddenId = rowEl.querySelector(`input[name="${fieldName}_id"]`);
    const visibleInput = rowEl.querySelector(`input#field-${fieldName}`);
    let changed = false;
    if (hiddenId && hiddenId.value !== "") {
      hiddenId.value = "";
      changed = true;
    }
    if (visibleInput && visibleInput.value !== "") {
      visibleInput.value = "";
      changed = true;
    }
    return changed;
  }

  const input = rowEl.querySelector("input, select, textarea");
  if (!input) return false;

  // Monétaire : toujours 2 décimales affichées (convention du renderer)
  if (finfo && finfo.type === "monetary" && typeof value === "number" && isFinite(value)) {
    return setScalar(input, value.toFixed(2));
  }
  return setScalar(input, value);
}

/**
 * Applique un patch de tableau one2many (backfill de lignes) dans le
 * tableau d'un champ one2many du formulaire. Chaque élément du tableau
 * correspond à une ligne existante : appariement par `_recordId` pour les
 * lignes déjà enregistrées, par ordre d'apparition pour les nouvelles.
 *
 * @returns {boolean} true si au moins une cellule a été modifiée
 */
function applyOne2manyPatch(containerEl, fieldName, lines, fieldsInfo) {
  if (!Array.isArray(lines)) return false;
  const wrapper = containerEl.querySelector(`[data-one2many="${fieldName}"] [data-o2m-root="true"]`);
  if (!wrapper || typeof wrapper._getTbody !== "function") return false;
  const tbody = wrapper._getTbody();
  const rows = Array.from(tbody.querySelectorAll("tr.o_data_row")).filter((tr) => tr._cellRefs);

  // Lignes sans id (nouvelles) : appariement en ordre d'apparition,
  // comme collectFormData() les énumère (lignes existantes puis nouvelles,
  // les lignes supprimées n'ont plus de tr correspondant).
  const anonRows = rows.filter((r) => !r._recordId);
  let anonIdx = 0;
  let anyChanged = false;

  for (const line of lines) {
    if (!line) continue;
    let tr;
    if (line.id !== undefined && line.id !== null && line.id !== false) {
      tr = rows.find((r) => String(r._recordId) === String(line.id));
    } else {
      tr = anonRows[anonIdx++];
    }
    if (!tr) continue;

    for (const [col, ref] of Object.entries(tr._cellRefs)) {
      if (!(col in line)) continue;
      const val = line[col];
      const finfo = ref.info;

      if (finfo && finfo.type === "many2many") {
        // Widget many2many_tags : l'input caché attend un JSON de ids
        // (cf. syncHiddenValue de many2many_tags_field.js). Les badges
        // visibles ne sont pas ré-éditables depuis l'extérieur (état en
        // closure) — ils se rafraîchiront au prochain rendu du formulaire
        // (recharge post-save, réouverture) ; la donnée (payload) est
        // immédiatement correcte.
        const cell = ref.el;
        const hidden = cell.querySelector('input[type="hidden"]');
        if (hidden) {
          const ids = (Array.isArray(val) ? val : [])
            .map((t) => (Array.isArray(t) ? t[0] : t))
            .filter((x) => x !== false && x !== null && x !== undefined);
          const json = JSON.stringify(ids);
          if (hidden.value !== json) {
            hidden.value = json;
            anyChanged = true;
          }
        }
        continue;
      }

      if (finfo && finfo.type === "many2one") {
        const cell = ref.el;
        const hidden = cell.querySelector('input[type="hidden"]');
        const visible = cell.querySelector('input:not([type="hidden"])');
        if (val && typeof val === "object" && !Array.isArray(val)) {
          if (hidden && hidden.value !== String(val.id ?? "")) {
            hidden.value = val.id ?? "";
            anyChanged = true;
          }
          if (visible && visible.value !== (val.display_name ?? "")) {
            visible.value = val.display_name ?? "";
            anyChanged = true;
          }
        } else if (Array.isArray(val)) {
          // Défensif : un tableau reçu sur un champ many2one (une règle
          // qui aurait écrit des taxes m2m dans un champ m2o unique) —
          // on ne peut pas écrire un tel valeur : on ignore (jamais de
          // "undefined" dans le DOM).
          continue;
        } else if (val === false || val === null || val === undefined) {
          if (hidden && hidden.value !== "") {
            hidden.value = "";
            anyChanged = true;
          }
          if (visible && visible.value !== "") {
            visible.value = "";
            anyChanged = true;
          }
        } else if (hidden && hidden.value !== String(val)) {
          hidden.value = String(val);
          anyChanged = true;
        }
        continue;
      }

      const input = ref.el.matches?.("input, select, textarea")
        ? ref.el
        : ref.el.querySelector?.("input, select, textarea");
      if (!input) continue;
      const normalized = val === null || val === false ? "" : val;
      if (input.type === "checkbox") {
        if (input.checked !== !!normalized) {
          input.checked = !!normalized;
          anyChanged = true;
        }
        continue;
      }
      // Monétaire : 2 décimales (convention du renderer)
      const asText =
        finfo && finfo.type === "monetary" && typeof normalized === "number" && isFinite(normalized)
          ? normalized.toFixed(2)
          : String(normalized);
      if (input.value !== asText) {
        input.value = asText;
        anyChanged = true;
        // Cascade : les règles onchange du formulaire (ex: produit →
        // sous-total) doivent détecter le changement programmé.
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
  }
  return anyChanged;
}

/**
 * @returns {Function} Cleanup function to be called when the form is
 * unmounted (removes the "input"/"change" listeners attached here).
 */
export function attachLiveBusinessRules(archXmlString, containerEl, fieldsInfo, model = null, helpers = null) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(archXmlString, "application/xml");
  const root = xmlDoc.documentElement;

  const dynamicFieldNodes = Array.from(root.querySelectorAll("field")).filter((node) => {
    return ["readonly", "required"].some((key) => {
      const raw = node.getAttribute(key);
      return raw && raw !== "1" && raw !== "True";
    });
  });

  // Computes de champ enregistrés pour ce modèle (clé "model:field")
  const fieldComputes = model
    ? fieldComputeRegistry.getEntries().filter(([key]) => key.startsWith(`${model}:`))
    : [];

  if (dynamicFieldNodes.length === 0 && fieldComputes.length === 0) return () => {};

  let running = false;
  const revaluateAll = () => {
    // Un seul cycle en vol à la fois : les règles sont asynchrones
    // (lecture du cache) et un input rapide ne doit pas empiler de
    // réévaluations qui se marcheraient dessus.
    if (running) return;
    running = true;
    (async () => {
      try {
        const currentValues = collectFormData(containerEl, fieldsInfo);

        dynamicFieldNodes.forEach((node) => {
          const fieldName = node.getAttribute("name");
          if (!fieldName) return;

          const wrapperEl = containerEl.querySelector(`[data-field-row="${fieldName}"] .o_field_widget`);
          if (!wrapperEl) return;

          const info = fieldsInfo[fieldName];
          const baseRequired = info ? !!info.required : false;

          resetDynamicAttrs(wrapperEl, baseRequired);
          applyDynamicAttrs(node, wrapperEl, currentValues);
        });

        // Computes de champ : fn(values, helpers, containerEl) => valeur | undefined
        // (containerEl permet aux computes de totaux de lire les données
        // complètes initiales des lignes — tr._serverData — pour le repli
        // hors-ligne des montants de taxes.)
        if (helpers) {
          for (const [key, fn] of fieldComputes) {
            const fieldName = key.split(":")[1];
            try {
              const value = await fn(currentValues, helpers, containerEl);
              writeFieldValue(containerEl, fieldName, fieldsInfo[fieldName], value);
            } catch (err) {
              console.warn(`Compute local ${key} échoué :`, err);
            }
          }
        }
      } finally {
        running = false;
      }
    })();
  };

  containerEl.addEventListener("input", revaluateAll);
  containerEl.addEventListener("change", revaluateAll);

  return () => {
    containerEl.removeEventListener("input", revaluateAll);
    containerEl.removeEventListener("change", revaluateAll);
  };
}

/**
 * Rejoue, au changement d'un champ, l'équivalent JS explicite d'un
 * @api.onchange Python enregistré pour ce modèle (voir
 * business_rules_registry.js). Ne couvre QUE les modèles/champs
 * explicitement enregistrés — pour tout le reste, comportement inchangé
 * (pas d'auto-remplissage, comme avant cette fonctionnalité).
 *
 * Une règle retourne un patch (dictionnaire champ -> valeur) et/ou :
 *  - `_warning: { title, message }`  → toast de notification (mirroir des
 *    onchanges Python renvoyant {'warning': ...}) ;
 *  - un tableau pour un champ one2many → backfill de lignes
 *    (applyOne2manyPatch), ex: onchange produit sur une ligne de commande.
 *
 * Après application, un événement "change" est ré-émis SUR CHAQUE CHAMP
 * DONT LA VALEUR A VRAIMENT CHANGÉ, pour enchaîner les règles
 * (cascade pricelist → devise, produit → sous-total…). Les règles
 * idempotentes ne modifiant plus rien font naturellement s'arrêter la
 * chaîne.
 *
 * @returns {Function} Cleanup function (à appeler au démontage du formulaire).
 */
export function attachLiveOnchange(model, containerEl, fieldsInfo, helpers) {
  const entries = onchangeRegistry.getEntries().filter(([key]) => key.startsWith(`${model}:`));
  if (entries.length === 0) return () => {};

  function applyPatch(patch) {
    const changedFields = [];
    for (const [fieldName, value] of Object.entries(patch)) {
      if (fieldName === "_warning") continue;

      const finfo = fieldsInfo[fieldName];

      // Backfill one2many : le patch est un tableau de lignes
      if (finfo && finfo.type === "one2many" && Array.isArray(value)) {
        if (applyOne2manyPatch(containerEl, fieldName, value, fieldsInfo)) {
          changedFields.push(fieldName);
        }
        continue;
      }

      const rowEl = containerEl.querySelector(`[data-field-row="${fieldName}"]`);
      if (!rowEl) continue;

      if (finfo && finfo.type === "many2one") {
        if (value === false || value === null || value === undefined || value === "") {
          // many2one ramené à false : on vide l'id caché ET l'affichage
          const hiddenId = rowEl.querySelector(`input[name="${fieldName}_id"]`);
          const visibleInput = rowEl.querySelector(`input#field-${fieldName}`);
          if (hiddenId && hiddenId.value !== "") {
            hiddenId.value = "";
            changedFields.push(fieldName);
          }
          if (visibleInput && visibleInput.value !== "") {
            visibleInput.value = "";
          }
          continue;
        }
      }

      if (finfo && finfo.type === "many2one" && value && typeof value === "object") {
        // Many2one : deux inputs à synchroniser (texte affiché + id caché) —
        // même paire que celle posée par renderMany2oneField().
        const hiddenId = rowEl.querySelector(`input[name="${fieldName}_id"]`);
        const visibleInput = rowEl.querySelector(`input#field-${fieldName}`);
        let changed = false;
        if (hiddenId && hiddenId.value !== String(value.id ?? "")) {
          hiddenId.value = value.id ?? "";
          changed = true;
        }
        if (visibleInput && visibleInput.value !== (value.display_name ?? "")) {
          visibleInput.value = value.display_name ?? "";
          changed = true;
        }
        if (changed) changedFields.push(fieldName);
        continue;
      }

      const input = rowEl.querySelector("input, select, textarea");
      if (!input) continue;
      const normalized = value === null || value === false || value === undefined ? "" : value;
      if (input.type === "checkbox") {
        if (input.checked !== !!normalized) {
          input.checked = !!normalized;
          changedFields.push(fieldName);
        }
      } else {
        const asText = typeof normalized === "number" ? String(normalized) : String(normalized);
        if (input.value !== asText) {
          input.value = asText;
          changedFields.push(fieldName);
        }
      }
    }
    return changedFields;
  }

  async function handler(e) {
    const rowEl = e.target?.closest("[data-field-row]");
    const fieldName = rowEl?.dataset.fieldRow;
    if (!fieldName) return;

    // Une clé sans "#" (ex. "sale.order:partner_id") reste une règle unique
    // sur ce champ. Une clé avec "#discriminant" (ex.
    // "sale.order:company_id#require_signature") permet à PLUSIEURS règles
    // indépendantes de se déclencher sur le même champ.
    const matches = entries.filter(
      ([key]) => key === `${model}:${fieldName}` || key.startsWith(`${model}:${fieldName}#`)
    );
    if (matches.length === 0) return;

    const currentValues = collectFormData(containerEl, fieldsInfo);
    const mergedPatch = {};
    let warning = null;
    for (const [key, fn] of matches) {
      try {
        const patch = await fn(currentValues[fieldName], currentValues, helpers);
        if (patch && typeof patch === "object") {
          if (patch._warning && !warning) warning = patch._warning;
          Object.assign(mergedPatch, patch);
        }
      } catch (err) {
        console.warn(`Onchange local échoué pour ${key}:`, err);
      }
    }
    if (Object.keys(mergedPatch).length === 0 && !warning) return;

    const changedFields = applyPatch(mergedPatch);

    // Mirroir du {'warning': ...} renvoyé par les onchanges Python
    if (warning) {
      notify({
        type: warning.block ? "danger" : "warning",
        title: warning.title,
        message: warning.message,
        duration: warning.block ? 6000 : 4500,
      });
    }

    // Cascade : ré-émet "change" uniquement sur les champs modifiés
    // (les règles idempotentes arrêtent la chaîne naturellement).
    for (const changed of changedFields) {
      const el = containerEl.querySelector(`[data-field-row="${changed}"] input, [data-field-row="${changed}"] select, [data-field-row="${changed}"] textarea`);
      if (el) el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  containerEl.addEventListener("change", handler);
  return () => containerEl.removeEventListener("change", handler);
}
