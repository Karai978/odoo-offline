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