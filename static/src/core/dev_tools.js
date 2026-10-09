/**
 * core/dev_tools.js
 * ====================
 * Outil de DÉVELOPPEMENT, à usage manuel depuis la console DevTools.
 * Jamais importé dans main.js -- ne fait partie d'aucun flux normal de l'app.
 *
 * Usage (console du navigateur, formulaire ouvert pour avoir apiKey en
 * scope, ou en le récupérant autrement) :
 *
 *   const dt = await import("./static/src/core/dev_tools.js");
 *   await dt.fetchAndStoreBusinessRules(apiKey, baseUrl, ["purchase."]);
 *   await dt.queryBusinessRules("purchase.order");
 */
import { db } from "./orm_service.js";

export async function fetchAndStoreBusinessRules(apiKey, baseUrl, modelPrefixes) {
  const prefixesParam = encodeURIComponent(modelPrefixes.join(","));
  const response = await fetch(
    `${baseUrl}/offline_sync/dev/extract_business_rules?model_prefixes=${prefixesParam}`,
    { headers: { Authorization: `Bearer ${apiKey}` } }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Extraction échouée (${response.status}) : ${body}`);
  }

  const { data, stats } = await response.json();
  const now = new Date().toISOString();

  await db.dev_business_rules.bulkPut(
    data.map((entry) => ({ ...entry, extracted_at: now }))
  );

  console.log(`[dev_tools] ${data.length} modèles stockés dans IndexedDB (table dev_business_rules).`);
  console.log("[dev_tools] stats:", stats);
  return { data, stats };
}

export async function queryBusinessRules(modelName) {
  return db.dev_business_rules.get(modelName);
}

export async function listExtractedModels() {
  return db.dev_business_rules.toCollection().primaryKeys();
}

/** Filtre pratique : toutes les règles dont au moins une couche fait super() --
 * ce sont celles qui nécessitent de lire plusieurs couches avant de traduire
 * (voir le cas réel rencontré : _compute_validity_date). */
export async function listRulesWithSuper(modelName) {
  const entry = await db.dev_business_rules.get(modelName);
  if (!entry) return [];
  const all = [...entry.compute_rules, ...entry.onchange_rules, ...entry.constrains_rules, ...entry.ondelete_rules];
  return all.filter((rule) => rule.layers.some((l) => l.calls_super));
}

// Signaux textuels (recherche de motifs, PAS de l'IA) suggérant qu'une
// méthode dépend d'autres modèles ou d'une recherche complexe -- juste pour
// prioriser la lecture manuelle, jamais pour décider automatiquement de
// traduire ou non.
const COMPLEXITY_SIGNALS = [
  { pattern: /\.search\(/, label: "fait une recherche (search)" },
  { pattern: /\.mapped\(/, label: "parcourt une collection (mapped)" },
  { pattern: /self\.env\[/, label: "accède à un autre modèle" },
  { pattern: /safe_eval/, label: "évalue une expression dynamique" },
  { pattern: /_get_default/, label: "appelle une logique de valeur par défaut" },
  { pattern: /with_context/, label: "dépend du contexte d'exécution" },
];

function estimateComplexity(layers) {
  const combinedSource = layers.map((l) => l.python_source || "").join("\n");
  const matched = COMPLEXITY_SIGNALS.filter(({ pattern }) => pattern.test(combinedSource));
  return {
    level: matched.length === 0 ? "simple" : matched.length <= 2 ? "moyen" : "complexe",
    signals: matched.map((m) => m.label),
  };
}

/**
 * Affiche en console, de façon lisible, toutes les règles d'un modèle
 * déjà extrait, triées par complexité estimée (simple d'abord). Sert à
 * décider rapidement QUOI relire/traduire en premier -- la décision de
 * traduire ou non reste manuelle, cet outil ne fait que prioriser.
 */
export async function formatRulesForReview(modelName) {
  const entry = await db.dev_business_rules.get(modelName);
  if (!entry) {
    console.warn(`Aucune extraction trouvée pour ${modelName}. Lancez fetchAndStoreBusinessRules d'abord.`);
    return [];
  }

  const groups = [
    ["compute (@api.depends)", entry.compute_rules],
    ["onchange (@api.onchange)", entry.onchange_rules],
    ["constrains (@api.constrains)", entry.constrains_rules],
    ["ondelete (@api.ondelete)", entry.ondelete_rules],
  ];

  const rows = [];
  for (const [kind, rules] of groups) {
    for (const rule of rules) {
      const { level, signals } = estimateComplexity(rule.layers);
      rows.push({
        kind,
        method: rule.method,
        trigger: (rule.depends_on || rule.triggers || []).join(", ") || "(aucun -- @api.ondelete)",
        layers: rule.layers.length,
        complexity: level,
        signals: signals.join(" / ") || "—",
      });
    }
  }

  rows.sort((a, b) => ["simple", "moyen", "complexe"].indexOf(a.complexity) - ["simple", "moyen", "complexe"].indexOf(b.complexity));
  console.table(rows);
  return rows;
}