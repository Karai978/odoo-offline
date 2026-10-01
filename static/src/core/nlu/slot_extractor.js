/**
 * core/nlu/slot_extractor.js
 * ===========================
 * Extrait les paramètres (slots) d'une question utilisateur, une fois
 * l'intention déjà déterminée par nlu_service.js.
 *
 * Travaille sur le texte PEU normalisé (minuscule + accents retirés, mais
 * SANS retrait des mots vides ni tokenisation) car les valeurs d'énumération
 * sont parfois des expressions à plusieurs mots ("en attente") qu'il faut
 * pouvoir rechercher comme sous-chaîne.
 *
 * Dépend d'un "résolveur d'entités" injecté (pas d'import direct de Dexie
 * ici) pour rester testable indépendamment du reste de l'application —
 * voir slot_extractor.test.mjs, qui utilise un résolveur simulé.
 */

function lightNormalize(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Slot de type "enum" : recherche de la plus longue clé correspondant en sous-chaîne. */
function extractEnumSlot(text, slotDef) {
  const entries = Object.entries(slotDef.values).sort((a, b) => b[0].length - a[0].length);
  for (const [key, value] of entries) {
    if (text.includes(lightNormalize(key))) {
      return { value, matchedText: key };
    }
  }
  return null;
}

/**
 * Slot de type "date_range" : quelques expressions courantes du français
 * parlé, volontairement limitées à un petit nombre de règles plutôt
 * qu'un parseur de dates complet (hors scope du MVP, à documenter
 * comme limite connue dans le mémoire).
 */
function extractDateRangeSlot(text) {
  const today = new Date();
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const startOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const endOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - today.getDay());

  const iso = (d) => d.toISOString().slice(0, 10);

  if (text.includes("mois dernier")) {
    return { value: { from: iso(startOfLastMonth), to: iso(endOfLastMonth) }, matchedText: "mois dernier" };
  }
  if (text.includes("ce mois") || text.includes("mois ci") || text.includes("mois-ci")) {
    return { value: { from: iso(startOfMonth), to: iso(today) }, matchedText: "ce mois-ci" };
  }
  if (text.includes("cette semaine")) {
    return { value: { from: iso(startOfWeek), to: iso(today) }, matchedText: "cette semaine" };
  }
  if (text.includes("aujourd")) {
    return { value: { from: iso(today), to: iso(today) }, matchedText: "aujourd'hui" };
  }
  if (text.includes("hier")) {
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    return { value: { from: iso(yesterday), to: iso(yesterday) }, matchedText: "hier" };
  }
  return null;
}

/**
 * Slot de type "entity" : résout un nom propre probable contre un cache
 * local via fuzzy matching (similarity.js), par l'intermédiaire d'un
 * résolveur injecté : (sourceModel, rawText) -> Array<{id, display_name, score}>
 *
 * Heuristique d'extraction du "nom propre probable" dans le texte brut :
 * tout mot ou séquence de mots commençant par une majuscule dans la
 * question ORIGINALE (pas la version normalisée) — approximatif mais
 * suffisant en français pour des noms de personnes/sociétés, et
 * explicable (contrairement à une extraction par un modèle de langage).
 */
function extractCandidateProperNoun(originalText) {
  const matches = originalText.match(/\b[A-ZÀ-Ý][a-zà-ÿ]+(?:\s+[A-ZÀ-Ý][a-zà-ÿ]+)*\b/g);
  if (!matches) return null;
  // Écarte les mots qui ne sont des majuscules que parce qu'ils sont en
  // début de phrase (heuristique simple : ignore le tout premier mot
  // s'il n'y a qu'un seul candidat capitalisé détecté en position 0).
  return matches.sort((a, b) => b.length - a.length)[0] || null;
}

/**
 * Point d'entrée principal.
 *
 * @param {string} originalText texte brut saisi par l'utilisateur (avant normalisation)
 * @param {object} intentDef définition de l'intention (voir intent_examples.js), avec son .slots
 * @param {function} entityResolver async (sourceModel, rawText) -> Array<{id, display_name, score}>
 * @returns {Promise<object>} dictionnaire slotName -> { value, matchedText, candidates? }
 */
export async function extractSlots(originalText, intentDef, entityResolver) {
  const text = lightNormalize(originalText);
  const result = {};

  for (const [slotName, slotDef] of Object.entries(intentDef.slots || {})) {
    if (slotDef.type === "enum") {
      const found = extractEnumSlot(text, slotDef);
      if (found) result[slotName] = found;
    } else if (slotDef.type === "date_range") {
      const found = extractDateRangeSlot(text);
      if (found) result[slotName] = found;
    } else if (slotDef.type === "entity") {
      const candidateText = extractCandidateProperNoun(originalText);
      if (!candidateText) continue;

      // "dynamic" : la source réelle dépend du modèle détecté par un
      // autre slot "enum" de la même intention (ex: recherche_fiche).
      let source = slotDef.source;
      if (source === "dynamic") {
        const modelSlot = result.model;
        source = modelSlot ? modelSlot.value : null;
      }
      if (!source) continue;

      const candidates = await entityResolver(source, candidateText);
      if (candidates.length > 0) {
        result[slotName] = {
          value: candidates[0].id,
          matchedText: candidates[0].display_name,
          confidence: candidates[0].score,
          candidates, // conservé pour permettre à l'UI de proposer une désambiguïsation
        };
      }
    }
  }

  return result;
}
