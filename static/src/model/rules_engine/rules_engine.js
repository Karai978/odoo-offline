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
  if ("computes" in rule) return "compute"; // @api.depends -- voir generate_rules_js.py
  return "onchange"; // @api.onchange -- pas de clé "computes" dans ce cas
}

/**
 * À appeler une seule fois au démarrage de l'app avec `allRules` importé
 * depuis rules_output_v2/index.js.
 */
export function initRulesEngine(allRules) {
  rulesByModel = new Map();
  for (const rule of allRules) {
    if (!rulesByModel.has(rule.model)) {
      rulesByModel.set(rule.model, { compute: [], onchange: [], constraint: [], ondelete: [] });
    }
    rulesByModel.get(rule.model)[classifyRule(rule)].push(rule);
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