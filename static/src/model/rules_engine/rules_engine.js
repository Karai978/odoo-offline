/**
 * model/rules_engine/rules_engine.js
 * ===================================
 * Moteur central qui consomme les règles générées depuis Odoo
 * (compute / onchange / constraint / ondelete_guard.
 *
 */

import { bus } from "../../core/bus/bus_service.js";
import { db } from "../../core/orm_service.js";

// ---------------------------------------------------------------------------
// Index des règles (construit une seule fois via initRulesEngine)
// ---------------------------------------------------------------------------

let rulesByModel = new Map();
// Snapshot synchrone des enregistrements de référence (product.product,
// account.tax, ...) utilisé par les compute()/validate() -- rafraîchi une
// fois par cycle de calcul, voir buildDbSnapshot().
let currentSnapshot = { get: () => undefined };

const MAX_CASCADE_ITERATIONS = 8; // garde-fou anti-boucle infinie

function classifyRule(rule) {
  if (rule.type === "constraint") return "constraint";
  if (rule.type === "ondelete_guard") return "ondelete";
  if (rule.type === "access") return "access"; // droits CRUD + groupes -- voir rules/access_rules.js
  if (rule.type === "domain") return "domain"; // classification métier + record rules -- voir rules/domain_rules.js
  if (rule.type === "default") return "default"; // valeurs par défaut implicites -- voir rules/default_rules.js
  if (rule.type === "stock_effect") return "stock_effect"; // effets de stock (ledger) -- voir rules/stock_rules.js
  if ("computes" in rule) return "compute"; // @api.depends -- voir generate_rules_js.py
  return "onchange"; // @api.onchange -- pas de clé "computes" dans ce cas
}

const RULE_BUCKETS = ["compute", "onchange", "constraint", "ondelete", "access", "domain", "default", "stock_effect"];

/**
 * Modèle spécial : règles applicables à tous les modèles (droits CRUD
 * génériques, valeur par défaut générique...). Ce n'est pas un vrai nom de
 * modèle Odoo -- juste une clé de regroupement dans rulesByModel.
 */
const WILDCARD_MODEL = "*";

/**
 * À appeler une seule fois au démarrage de l'app avec `allRules` importé
 * depuis model/rules_engine/rules/index.js.
 */
export function initRulesEngine(allRules) {
  rulesByModel = new Map();
  for (const rule of allRules) {
    if (!rulesByModel.has(rule.model)) {
      const buckets = {};
      RULE_BUCKETS.forEach((b) => (buckets[b] = []));
      rulesByModel.set(rule.model, buckets);
    }
    rulesByModel.get(rule.model)[classifyRule(rule)].push(rule);
  }
}

/**
 * Concatène les règles d'un bucket donné pour un modèle précis ET pour le
 * modèle générique "*" (ex: droits CRUD, valables pour tous les modèles).
 */
function getRulesForModel(model, bucket) {
  const generic = rulesByModel.get(WILDCARD_MODEL);
  const specific = rulesByModel.get(model);
  return [
    ...(generic ? generic[bucket] : []),
    ...(specific && model !== WILDCARD_MODEL ? specific[bucket] : []),
  ];
}

/**
 * Exécute rule.evaluate(...) en capturant toute exception -- même logique
 * de robustesse que safeCall(), mais pour les règles "access"/"domain"/
 * "default" qui n'opèrent pas sur un documentGraph.
 */
function safeEvaluate(rule, ...args) {
  try {
    return rule.evaluate(...args);
  } catch (err) {
    console.error(`[rules_engine] Erreur dans la règle ${rule.name || rule.method} (${rule.model}):`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Adaptateur "db" passé aux fonctions compute()/validate() générées
// ---------------------------------------------------------------------------

/**
 * Construit un snapshot synchrone des enregistrements de référence
 * nécessaires (produits, taxes...), à partir des caches Dexie existants
 * (reference_records). Les compute()/validate() générés sont écrits comme
 * des fonctions pures et SYNCHRONES (db.get(model, id) sans await) -- on
 * résout donc tout l'asynchrone AVANT de les appeler, une fois par cycle,
 * plutôt qu'à chaque règle individuelle (évite N allers-retours Dexie).
 */
async function buildDbSnapshot(modelsNeeded) {
  const cache = new Map(); // clé "model:id" -> record

  for (const model of modelsNeeded) {
    const rows = await db.reference_records.where({ model }).toArray();
    for (const row of rows) {
      cache.set(`${model}:${row.id}`, row);
    }
  }

  return {
    get(model, id) {
      return cache.get(`${model}:${id}`) || null;
    },
  };
}

// ---------------------------------------------------------------------------
// Matching des règles déclenchées par un changement de champ
// ---------------------------------------------------------------------------

/**
 * Un trigger simple ("product_uom_qty") matche un changement direct sur le
 * même enregistrement. Un trigger pointé ("order_line.price_total") matche
 * un changement survenu sur UNE LIGNE du champ one2many "order_line" --
 * utilisé pour les règles du document racine qui dépendent de ses lignes.
 */
function directTriggerMatches(rule, changedField) {
  return rule.trigger.fields.some((f) => !f.includes(".") && f === changedField);
}

function lineTriggerMatches(rule, o2mFieldName, changedSubField) {
  const dotted = `${o2mFieldName}.${changedSubField}`;
  return rule.trigger.fields.some((f) => f === dotted);
}

// ---------------------------------------------------------------------------
// Exécution : compute + onchange sur un document (racine + lignes)
// ---------------------------------------------------------------------------

/**
 * @param {string} rootModel - ex: "sale.order"
 * @param {Object} documentGraph - {
 *     root: { ...champs de l'enregistrement racine },
 *     lines: {
 *       order_line: { model: "sale.order.line", rows: [ {...}, {...} ] },
 *       ...
 *     }
 *   }
 * @returns {Object} le documentGraph mis à jour (nouvelle référence)
 */
export async function runDocumentRules(rootModel, documentGraph) {
  const modelsInvolved = new Set([rootModel]);
  for (const { model } of Object.values(documentGraph.lines || {})) {
    modelsInvolved.add(model);
  }
  currentSnapshot = await buildDbSnapshot(modelsInvolved);

  let graph = {
    root: { ...documentGraph.root },
    lines: Object.fromEntries(
      Object.entries(documentGraph.lines || {}).map(([k, v]) => [k, { ...v, rows: v.rows.map((r) => ({ ...r })) }])
    ),
  };

  let changedFieldsQueue = [{ scope: "root", field: null }]; // null = premier passage, on évalue tout
  let iteration = 0;

  while (changedFieldsQueue.length > 0 && iteration < MAX_CASCADE_ITERATIONS) {
    iteration++;
    const nextQueue = [];

    // 1) Règles sur les LIGNES (chaque ligne de chaque one2many)
    for (const [o2mField, { model: lineModel, rows }] of Object.entries(graph.lines)) {
      const rulesForModel = rulesByModel.get(lineModel);
      if (!rulesForModel) continue;

      rows.forEach((line, idx) => {
        for (const rule of [...rulesForModel.compute, ...rulesForModel.onchange]) {
          const triggered = changedFieldsQueue.some(
            (c) => c.scope === "root" && c.field === null // premier passage : tout évaluer
              || (c.scope === `${o2mField}[${idx}]` && directTriggerMatches(rule, c.field))
          );
          if (!triggered) continue;

          const updates = safeCall(rule, line, currentSnapshot);
          if (!updates) continue;

          for (const [field, value] of Object.entries(updates)) {
            if (line[field] !== value) {
              line[field] = value;
              nextQueue.push({ scope: `${o2mField}[${idx}]`, field });
              nextQueue.push({ scope: "root", field: `${o2mField}.${field}` }); // pour déclencher les règles racine dépendantes
            }
          }
        }
      });
    }

    // 2) Règles sur la RACINE (peuvent dépendre de champs propres ou de lignes)
    const rulesForRoot = rulesByModel.get(rootModel);
    if (rulesForRoot) {
      const rootRecordForCompute = {
        ...graph.root,
        ...Object.fromEntries(Object.entries(graph.lines).map(([k, v]) => [k, v.rows])),
      };

      for (const rule of [...rulesForRoot.compute, ...rulesForRoot.onchange]) {
        const triggered = changedFieldsQueue.some((c) => {
          if (c.scope === "root" && c.field === null) return true; // premier passage
          if (c.scope === "root" && directTriggerMatches(rule, c.field)) return true;
          if (c.scope === "root" && c.field && c.field.includes(".")) {
            const [o2mField, subField] = c.field.split(".");
            return lineTriggerMatches(rule, o2mField, subField);
          }
          return false;
        });
        if (!triggered) continue;

        const updates = safeCall(rule, rootRecordForCompute, currentSnapshot);
        if (!updates) continue;

        for (const [field, value] of Object.entries(updates)) {
          if (graph.root[field] !== value) {
            graph.root[field] = value;
            nextQueue.push({ scope: "root", field });
          }
        }
      }
    }

    changedFieldsQueue = nextQueue;
  }

  if (iteration >= MAX_CASCADE_ITERATIONS) {
    console.warn(
      `[rules_engine] Arrêt après ${MAX_CASCADE_ITERATIONS} itérations sur ${rootModel} -- ` +
      "cycle de dépendances probable entre règles, à investiguer."
    );
  }

  bus.trigger("rules:document-updated", { model: rootModel, graph });
  return graph;
}

/**
 * Exécute compute()/validate() en capturant toute exception -- une règle
 * mal réimplémentée (ou pas encore réimplémentée, TODO laissé tel quel) ne
 * doit jamais faire planter tout le moteur pour les autres règles.
 */
function safeCall(rule, record, dbSnapshot) {
  try {
    return rule.compute(record, dbSnapshot);
  } catch (err) {
    console.error(`[rules_engine] Erreur dans ${rule.model}.${rule.method}:`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Effets de stock (règles "stock_effect") -- voir rules/stock_rules.js
// ---------------------------------------------------------------------------

/**
 * Calcule les effets de stock déclenchés par l'exécution d'une méthode
 * objet (ex: stock.picking::button_validate) -- reproduit le workflow
 * Odoo 17 où c'est la VALIDATION du bon (pas la confirmation de la
 * commande d'achat/vente) qui modifie réellement le stock et les
 * quantités reçues/livrées.
 *
 * Ne modifie rien elle-même : retourne la liste des deltas à écrire via
 * core/local_ledger.js::addLedgerDelta() -- le caller (form_controller.js)
 * est responsable de l'écriture car lui seul connaît le local_uuid de
 * l'action en cours.
 *
 * @param {string} model - modèle sur lequel la méthode est appelée (ex: "stock.picking")
 * @param {string} methodName - nom de la méthode (ex: "button_validate")
 * @param {Object} documentGraph - {root, lines} (voir form_serializer.js::buildDocumentGraph)
 * @returns {Promise<Array<{model, key, deltaField, delta}>>}
 */
export async function computeStockEffects(model, methodName, documentGraph) {
  const rules = getRulesForModel(model, "stock_effect").filter((r) => r.method === methodName);
  if (rules.length === 0) return [];

  const modelsInvolved = new Set([model]);
  for (const { model: lineModel } of Object.values(documentGraph.lines || {})) modelsInvolved.add(lineModel);
  const dbSnapshot = await buildDbSnapshot(modelsInvolved);

  const deltas = [];
  for (const rule of rules) {
    const result = safeCall(rule, documentGraph, dbSnapshot);
    if (Array.isArray(result)) deltas.push(...result);
  }
  return deltas;
}

/**
 * Calcule la mise à jour OPTIMISTE (locale, immédiate, avant toute
 * synchronisation) déclenchée par l'exécution d'une méthode objet -- ex:
 * stock.picking::button_validate passe state "assigned" -> "done" et
 * marque chaque ligne "picked" dans l'attente, pour que l'écran reflète
 * tout de suite l'action même hors-ligne. Complémentaire de
 * computeStockEffects() (qui calcule les deltas d'AUTRES enregistrements,
 * ex: qty_received sur la commande d'origine) -- celle-ci ne concerne que
 * l'enregistrement sur lequel le bouton a été cliqué.
 *
 * Synchrone : ne modifie aucune donnée elle-même, ne fait aucun I/O --
 * c'est au caller (form_controller.js) d'appliquer le résultat au DOM et
 * au cache local.
 *
 * @returns {{ root: Object, lineUpdates: Object }} - root: champs à
 *   fusionner sur l'enregistrement racine ; lineUpdates: champs à
 *   fusionner sur CHAQUE ligne du one2many concerné (mêmes valeurs pour
 *   toutes les lignes -- pas de logique par ligne pour l'instant).
 */
export function computeOptimisticStateUpdate(model, methodName, documentGraph) {
  const rules = getRulesForModel(model, "stock_effect").filter(
    (r) => r.method === methodName && typeof r.optimisticState === "function"
  );

  const result = { root: {}, lineUpdates: {} };
  for (const rule of rules) {
    let partial;
    try {
      partial = rule.optimisticState(documentGraph);
    } catch (err) {
      console.error(`[rules_engine] Erreur optimisticState ${model}.${rule.method}:`, err);
      continue;
    }
    if (partial && partial.root) Object.assign(result.root, partial.root);
    if (partial && partial.lineUpdates) Object.assign(result.lineUpdates, partial.lineUpdates);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Validation : constraints + ondelete_guard (appelés à la demande, PAS en
// cascade automatique -- typiquement juste avant queueAction() dans
// form_controller.js)
// ---------------------------------------------------------------------------

/**
 * @returns {{ valid: boolean, errors: Array<{model, method, message}> }}
 */
export async function validateDocument(rootModel, documentGraph) {
  const modelsInvolved = new Set([rootModel]);
  for (const { model } of Object.values(documentGraph.lines || {})) {
    modelsInvolved.add(model);
  }
  currentSnapshot = await buildDbSnapshot(modelsInvolved);

  const errors = [];

  const checkOne = (model, record) => {
    const rulesForModel = rulesByModel.get(model);
    if (!rulesForModel) return;
    for (const rule of rulesForModel.constraint) {
      let result;
      try {
        result = rule.validate(record, currentSnapshot);
      } catch (err) {
        console.error(`[rules_engine] Erreur dans la validation ${model}.${rule.method}:`, err);
        continue;
      }
      if (result && result.valid === false) {
        errors.push({ model, method: rule.method, message: result.message || "Validation échouée." });
      }
    }
  };

  checkOne(rootModel, documentGraph.root);
  for (const { model, rows } of Object.values(documentGraph.lines || {})) {
    rows.forEach((row) => checkOne(model, row));
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Vérifie si un enregistrement (racine ou ligne) peut être supprimé
 * localement, selon les règles @api.ondelete extraites.
 * @returns {{ valid: boolean, message?: string }}
 */
export function checkOndeleteGuard(model, record) {
  const rulesForModel = rulesByModel.get(model);
  if (!rulesForModel) return { valid: true };

  for (const rule of rulesForModel.ondelete) {
    let result;
    try {
      result = rule.validate(record, currentSnapshot);
    } catch (err) {
      console.error(`[rules_engine] Erreur dans le guard ${model}.${rule.method}:`, err);
      continue;
    }
    if (result && result.valid === false) {
      return { valid: false, message: result.message || "Suppression bloquée par une règle métier." };
    }
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// Règles "access" : droits CRUD (ir.model.access) + visibilité par groupe.
// Déplacées depuis core/user_service.js::canPerform() et
// core/py_js/py_utils.js::isNodeVisible() -- voir rules/access_rules.js.
// ---------------------------------------------------------------------------

/**
 * @param {string} model
 * @param {string} action - "read" | "write" | "create" | "unlink"
 * @param {Object} securityContext - { is_admin, rights } (voir user_service.js)
 * @returns {boolean}
 */
export function canPerformAction(model, action, securityContext) {
  const rules = getRulesForModel(model, "access").filter((r) => r.subtype === "crud");
  if (rules.length === 0) return false; // pas de règle enregistrée -- refus par défaut, comme l'ancien canPerform()
  return rules.every((rule) => safeEvaluate(rule, securityContext, action) !== false);
}

/**
 * @param {string} groupsAttr - valeur brute de l'attribut XML groups="..."
 * @param {Object} securityContext - { is_admin, groups }
 * @returns {boolean}
 */
export function isAllowedByGroups(groupsAttr, securityContext) {
  const rules = getRulesForModel(WILDCARD_MODEL, "access").filter((r) => r.subtype === "groups");
  if (rules.length === 0) return true; // pas de règle enregistrée -- ne bloque rien
  return rules.every((rule) => safeEvaluate(rule, groupsAttr, securityContext) !== false);
}

// ---------------------------------------------------------------------------
// Règles "domain" : classification métier nommée (ex: dashboard achats) et
// application des record rules (ir.rule) -- voir rules/domain_rules.js.
// ---------------------------------------------------------------------------

/**
 * Évalue une règle de domaine nommée (ex: "purchase_dashboard_state") avec
 * les paramètres fournis, et retourne ce que la règle calcule (typiquement
 * un domaine Odoo [[field, op, value], ...]).
 */
export function evaluateNamedDomain(name, params) {
  for (const [, buckets] of rulesByModel) {
    const found = buckets.domain.find((r) => r.name === name);
    if (found) return safeEvaluate(found, params);
  }
  console.warn(`[rules_engine] Aucune règle de domaine nommée "${name}" trouvée.`);
  return null;
}

/**
 * Filtre une liste d'enregistrements selon les record rules (ir.rule) du
 * modèle -- récupérées par user_service.js dans securityInfo.record_rule_domain
 * mais jamais appliquées jusqu'ici (voir audit).
 * @returns {Array} le sous-ensemble des enregistrements autorisés
 */
export function filterByRecordRule(model, records, securityInfo) {
  const rules = getRulesForModel(model, "domain").filter((r) => r.subtype === "record_rule");
  if (rules.length === 0) return records;
  return records.filter((record) => rules.every((rule) => safeEvaluate(rule, record, securityInfo) !== false));
}

// ---------------------------------------------------------------------------
// Règles "default" : valeurs par défaut implicites -- voir rules/default_rules.js.
// ---------------------------------------------------------------------------

/**
 * @returns {*} la valeur par défaut si une règle s'applique, sinon undefined
 */
export function getDefaultValue(model, field, currentValues) {
  const rules = getRulesForModel(model, "default").filter((r) => r.field === field);
  for (const rule of rules) {
    const result = safeEvaluate(rule, currentValues);
    if (result !== undefined && result !== null) return result;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Exécution compute/onchange pour UNE SEULE ligne, sans documentGraph complet
// -- utilisé par les widgets qui manipulent le DOM directement (ex:
// x2many_field.js), qui n'ont pas besoin de la cascade complète sur
// racine+lignes gérée par runDocumentRules().
// ---------------------------------------------------------------------------

/**
 * @param {string} lineModel - ex: "purchase.order.line"
 * @param {Object} line - valeurs actuelles de la ligne
 * @param {Object} [options]
 * @param {Array<string>|null} [options.changedFields] - champs modifiés
 *   (null = tout évaluer, comme le premier passage de runDocumentRules)
 * @param {Object} [options.dbSnapshot] - objet { get(model, id) } ; par
 *   défaut le dernier snapshot construit par runDocumentRules/validateDocument,
 *   mais peut être fourni directement (ex: catalogue produits déjà en mémoire)
 * @returns {Object} uniquement les champs mis à jour par les règles
 */
export function runLineRules(lineModel, line, { changedFields = null, dbSnapshot = currentSnapshot } = {}) {
  const rulesForModel = rulesByModel.get(lineModel);
  if (!rulesForModel) return {};

  const working = { ...line };
  const updates = {};

  for (const rule of [...rulesForModel.onchange, ...rulesForModel.compute]) {
    const triggered = changedFields === null || rule.trigger.fields.some((f) => changedFields.includes(f));
    if (!triggered) continue;

    const result = safeCall(rule, working, dbSnapshot);
    if (!result) continue;

    Object.assign(working, result);
    Object.assign(updates, result);
  }

  return updates;
}