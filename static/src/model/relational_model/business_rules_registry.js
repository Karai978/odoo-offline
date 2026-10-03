/**
 * model/relational_model/business_rules_registry.js
 * ====================================================
 * Point d'entrée UNIQUE pour enregistrer, modèle par modèle, l'équivalent
 * JS explicite d'une méthode Python décorée @api.depends / @api.onchange /
 * @api.constrains. Le moteur reste générique : rien n'est câblé en dur par
 * défaut, chaque module métier enregistre ce dont il a besoin.
 *
 */
import { registry } from "../../core/registry.js";

export const computeRegistry = registry.category("offline_compute");
export const onchangeRegistry = registry.category("offline_onchange");
export const constraintsRegistry = registry.category("offline_constraints");

/**
 * Computes de champ simple (l'équivalent JS des @api.depends non one2many
 * d'Odoo, ex: sale.order._compute_amounts, purchase.order._compute_date_planned).
 *
 * Clé : "model:field" (ex: "sale.order:amount_total")
 * Valeur : fn(values, helpers) => valeur | undefined
 *   - values : l'objet valeurs courant du formulaire (collectFormData)
 *   - helpers : { getReferenceRecordsSmart, getRecordSmart, apiKey, baseUrl }
 *   - retourner undefined pour ne pas toucher au champ.
 *
 * Réévalué à chaque événement input/change par attachLiveBusinessRules()
 * (model/relational_model/relational_model.js) et écrit dans le DOM si le
 * champ est présent dans la vue.
 */
export const fieldComputeRegistry = registry.category("offline_field_compute");