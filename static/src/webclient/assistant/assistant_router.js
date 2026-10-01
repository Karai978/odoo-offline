/**
 * webclient/assistant/assistant_router.js
 * =========================================
 * Pont entre la couche NLU (intention + slots) et les services déjà
 * existants de l'application (list_cache, record_cache, dashboard,
 * sync queue). Ne contient AUCUNE logique métier propre : il ne fait
 * qu'orchestrer des fonctions déjà présentes ailleurs dans le code,
 * pour éviter toute duplication de logique.
 */

import { db } from "../../core/orm_service.js";
import { getApiKey, CONFIG } from "../../core/browser/session.js";
import { getPurchaseDashboardSmart } from "../../core/list_cache.js";
import { getRecordSmart } from "../../core/record_cache.js";
import { getSyncQueueSummary, getCachedConflicts } from "../../core/network/rpc_service.js";
import { findBestMatches } from "../../core/similarity.js";
import { classifyIntent, getDefaultCorpus } from "../../core/nlu/nlu_service.js";
import { extractSlots } from "../../core/nlu/slot_extractor.js";
import { INTENTS } from "../../core/nlu/intent_examples.js";

/**
 * Table de correspondance champ métier par modèle — nécessaire car le
 * nom technique du champ "client" ou "statut" diffère selon le modèle
 * Odoo visé. À étendre modèle par modèle plutôt que de prétendre à une
 * généricité totale impossible à garantir sans lire le manifest complet
 * de chaque modèle à l'exécution (voir limites, section mémoire).
 */
const MODEL_FIELD_MAP = {
  "sale.order": { partnerField: "partner_id", statusField: "state" },
  "account.move": { partnerField: "partner_id", statusField: "payment_state" },
};

/**
 * Résolveur d'entités branché sur le cache local réel (Dexie), utilisé
 * par slot_extractor.js. Lit uniquement reference_records (déjà peuplé
 * hors ligne par name_service.js lors du téléchargement complet d'une
 * app) — aucun appel réseau nécessaire, fonctionne donc aussi déconnecté.
 */
async function dexieEntityResolver(sourceModel, rawText) {
  const rows = await db.reference_records.where("model").equals(sourceModel).toArray();
  return findBestMatches(rawText, rows, { limit: 5, minScore: 0.4 });
}

/** Récupère tous les enregistrements en cache pour un modèle, quel que
 * soit l'actionId sous lequel ils ont été indexés (voir list_cache.js :
 * la clé est "model" ou "model::actionId"), et déduplique par id. */
async function getAllCachedRecordsForModel(modelName) {
  const entries = await db.list_cache.where("model").startsWith(modelName).toArray();
  // Inclut aussi l'entrée sans suffixe (clé exactement égale au modèle).
  const exact = await db.list_cache.get(modelName);
  const allEntries = exact ? [exact, ...entries.filter((e) => e.model !== modelName)] : entries;

  const byId = new Map();
  for (const entry of allEntries) {
    for (const record of entry.records || []) {
      byId.set(record.id, record);
    }
  }
  return Array.from(byId.values());
}

/** Extrait un id Odoo d'une valeur many2one, qui peut être soit un id
 * brut, soit une paire [id, display_name] (format read_record()). */
function extractM2oId(value) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function filterRecords(records, { partnerField, statusField }, slots) {
  return records.filter((r) => {
    if (slots.client && partnerField) {
      const recordPartnerId = extractM2oId(r[partnerField]);
      if (recordPartnerId !== slots.client.value) return false;
    }
    if (slots.statut && statusField) {
      if (r[statusField] !== slots.statut.value) return false;
    }
    if (slots.periode) {
      const dateField = r.date_order || r.invoice_date || r.create_date;
      if (dateField) {
        const d = String(dateField).slice(0, 10);
        if (d < slots.periode.value.from || d > slots.periode.value.to) return false;
      }
    }
    return true;
  });
}

// =============================================================================
// Un handler par intention : (slots) -> { text, data? }
// =============================================================================

async function handleRechercheListe(slots) {
  if (!slots.model) {
    return { text: "Je n'ai pas compris quel type d'enregistrement tu cherches (commandes, factures...)." };
  }
  const modelName = slots.model.value;
  const fieldMap = MODEL_FIELD_MAP[modelName] || {};

  const allRecords = await getAllCachedRecordsForModel(modelName);
  if (allRecords.length === 0) {
    return { text: `Aucune donnée en cache pour "${modelName}" — télécharge d'abord cette application pour un usage hors ligne.` };
  }

  const filtered = filterRecords(allRecords, fieldMap, slots);

  const parts = [];
  if (slots.client) parts.push(`de ${slots.client.matchedText}`);
  if (slots.statut) parts.push(`(statut: ${slots.statut.matchedText})`);
  if (slots.periode) parts.push(`sur la période ${slots.periode.value.from} → ${slots.periode.value.to}`);

  return {
    text: `${filtered.length} résultat(s) trouvé(s) ${parts.join(" ")}.`.trim(),
    data: filtered.slice(0, 20), // limite d'affichage, l'UI peut proposer "voir tout"
  };
}

async function handleRechercheFiche(slots) {
  if (!slots.model || !slots.nom) {
    return { text: "Je n'ai pas identifié de quel enregistrement il s'agit. Essaie par exemple : \"ouvre la fiche de Rakoto\"." };
  }
  const record = await getRecordSmart(slots.model.value, slots.nom.value, getApiKey(), CONFIG.ODOO_BASE_URL);
  return {
    text: `Fiche trouvée : ${record.display_name || slots.nom.matchedText}`,
    data: { model: slots.model.value, id: slots.nom.value, record },
  };
}

async function handleEtatSync() {
  const summary = await getSyncQueueSummary();
  if (summary.pending === 0 && summary.error === 0) {
    return { text: "Tout est synchronisé, aucune action en attente." };
  }
  const parts = [];
  if (summary.pending > 0) parts.push(`${summary.pending} action(s) en attente d'envoi`);
  if (summary.error > 0) parts.push(`${summary.error} action(s) en erreur`);
  return { text: parts.join(", ") + "." };
}

async function handleExplicationConflit() {
  const conflicts = await getCachedConflicts();
  if (conflicts.length === 0) {
    return { text: "Aucun conflit de synchronisation en attente." };
  }
  const summaryLines = conflicts.slice(0, 5).map((c) => {
    const fields = (c.conflicts || []).map((f) => f.field).join(", ");
    return `• ${c.model_name} — champ(s) en conflit : ${fields || "voir détail"}`;
  });
  return {
    text: `${conflicts.length} conflit(s) en attente d'arbitrage :\n${summaryLines.join("\n")}`,
    data: conflicts,
  };
}

async function handleKpiAchats() {
  const dashboard = await getPurchaseDashboardSmart(getApiKey(), CONFIG.ODOO_BASE_URL);
  if (!dashboard) {
    return { text: "Aucune donnée de tableau de bord Achats en cache." };
  }
  return { text: "Voici le tableau de bord Achats.", data: dashboard };
}

const HANDLERS = {
  recherche_liste: handleRechercheListe,
  recherche_fiche: handleRechercheFiche,
  etat_sync: handleEtatSync,
  explication_conflit: handleExplicationConflit,
  kpi_achats: handleKpiAchats,
};

/**
 * Point d'entrée principal appelé par assistant_panel.js.
 * @param {string} query texte brut saisi par l'utilisateur
 * @returns {Promise<{ text: string, data?: any, intent: string, confidence: number }>}
 */
export async function handleUserQuery(query) {
  const corpus = getDefaultCorpus();
  const { intent, confidence } = classifyIntent(query, corpus);

  if (intent === "inconnue") {
    return {
      intent,
      confidence,
      text: "Je n'ai pas bien compris. Peux-tu reformuler ? (ex: \"montre les commandes en attente de...\")",
    };
  }

  const intentDef = INTENTS[intent];
  const slots = await extractSlots(query, intentDef, dexieEntityResolver);
  const handler = HANDLERS[intent];

  if (!handler) {
    return { intent, confidence, text: "Cette fonctionnalité n'est pas encore disponible." };
  }

  try {
    const result = await handler(slots);
    return { intent, confidence, slots, ...result };
  } catch (err) {
    console.error("[assistant_router] Erreur lors du traitement de l'intention", intent, err);
    return { intent, confidence, text: "Une erreur est survenue en traitant ta demande." };
  }
}
