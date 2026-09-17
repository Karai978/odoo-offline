/**
 * owl/field_bridge.js
 * ====================
*/

import { mountOwlApp } from "./app.js";
import { evaluateSimpleCondition } from "../core/py_js/py_utils.js";

/**
 * Même logique que dynamic_field_attrs.js::applyDynamicAttrs, côté
 * readonly, mais ne produit qu'un booléen (pas de mutation DOM) —
 * partagée par tous les widgets OWL migrés.
 */
export function computeReadonly(node, initialValues) {
  if (!node) return false;
  const readonlyExpr = node.getAttribute("readonly");
  if (!readonlyExpr) return false;
  if (readonlyExpr === "1" || readonlyExpr === "True") return true;
  return evaluateSimpleCondition(readonlyExpr, initialValues) === true;
}

/**
 * Idem côté required. `info.required` reflète le required statique
 * défini par le modèle (fields_get) ; l'attribut `required="expr"` sur
 * le nœud <field> ne porte, comme dans l'original, que les expressions
 * dynamiques (jamais "1"/"True", déjà couvert par info.required).
 */
export function computeRequired(node, info, initialValues) {
  if (info.required) return true;
  if (!node) return false;
  const requiredExpr = node.getAttribute("required");
  if (!requiredExpr || requiredExpr === "1" || requiredExpr === "True") return false;
  return evaluateSimpleCondition(requiredExpr, initialValues) === true;
}

/**
 * Crée le conteneur synchrone + lance le mount OWL dedans + retourne le
 * conteneur immédiatement. C'est le cœur de l'adaptateur : chaque
 * renderXField() n'a plus qu'à l'appeler avec son Component et ses props.
 *
 * @param {typeof owl.Component} Component
 * @param {Object} options
 * @param {string} options.name - nom du champ (pour data-owl-field et les logs)
 * @param {string} options.fieldTypeClass - ex: "char", "text", "boolean"
 *   -> classe CSS `o_field_<fieldTypeClass>_mount` sur le conteneur
 * @param {Object} options.props - props passées telles quelles au Component
 * @returns {HTMLElement} le conteneur, à insérer immédiatement dans le DOM
 */
export function renderOwlField(Component, { name, fieldTypeClass, props }) {
  const mountPoint = document.createElement("span");
  mountPoint.className = `o_owl_mount o_field_${fieldTypeClass}_mount`;
  mountPoint.setAttribute("data-owl-field", name);

  mountOwlApp(Component, mountPoint, props).catch((err) => {
    console.error(
      `[field_bridge] échec du mount OWL pour "${name}" (${fieldTypeClass}) :`,
      err
    );
  });

  return mountPoint;
}