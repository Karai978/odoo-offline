/**
 * core/nlu/nlu_service.js
 * ========================
 * Classifieur d'intention TF-IDF + k plus proches voisins (k-NN).
 *
 * Choix assumé (à documenter dans le mémoire) : pas de framework ML, pas
 * de poids appris séparément par une boucle d'entraînement — le corpus
 * d'exemples EST le modèle. Ça tourne instantanément en JS pur, sans GPU,
 * sans téléchargement de modèle, et reste entièrement explicable : on
 * peut toujours montrer quelles phrases d'exemple ont motivé une
 * classification donnée.
 *
 * Toutes les fonctions sont pures (aucune dépendance à Dexie/DOM), donc
 * testables indépendamment du reste de l'application (voir nlu_service.test.js).
 */

import { INTENTS, STOPWORDS } from "./intent_examples.js";

/**
 * Normalise un texte : minuscule, retrait des accents et de la
 * ponctuation, tokenisation par espace, retrait des mots vides.
 */
export function normalize(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // retire les diacritiques
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOPWORDS.has(w));
}

/**
 * Construit, une seule fois (au démarrage de l'application), le corpus
 * TF-IDF à partir de toutes les phrases d'exemple de toutes les intentions.
 *
 * @returns {{ vectors: Array<{intent: string, vector: Object}>, idf: Object }}
 */
export function buildCorpus(intents = INTENTS) {
  const documents = [];
  for (const [intentName, def] of Object.entries(intents)) {
    for (const phrase of def.examples) {
      documents.push({ intent: intentName, tokens: normalize(phrase) });
    }
  }

  if (documents.length === 0) {
    throw new Error("[nlu_service] Le corpus d'intentions est vide.");
  }

  // Document frequency : dans combien de phrases chaque mot apparaît-il.
  const df = {};
  for (const doc of documents) {
    new Set(doc.tokens).forEach((w) => {
      df[w] = (df[w] || 0) + 1;
    });
  }

  const idf = {};
  for (const w in df) {
    // +1 au dénominateur et au numérateur (lissage) pour éviter une
    // division par un IDF nul si un mot apparaissait dans 100% des phrases.
    idf[w] = Math.log((documents.length + 1) / (df[w] + 1)) + 1;
  }

  const vectors = documents.map((doc) => ({
    intent: doc.intent,
    phrase: doc.tokens.join(" "),
    vector: tfidfVector(doc.tokens, idf),
  }));

  return { vectors, idf };
}

/** Convertit une liste de tokens en vecteur TF-IDF (objet mot -> poids). */
export function tfidfVector(tokens, idf) {
  if (tokens.length === 0) return {};
  const tf = {};
  tokens.forEach((w) => {
    tf[w] = (tf[w] || 0) + 1;
  });
  const vec = {};
  for (const w in tf) {
    vec[w] = (tf[w] / tokens.length) * (idf[w] || 0);
  }
  return vec;
}

/** Similarité cosinus entre deux vecteurs TF-IDF (objets creux). */
export function cosineSimilarity(vecA, vecB) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const w in vecA) {
    normA += vecA[w] ** 2;
    if (vecB[w]) dot += vecA[w] * vecB[w];
  }
  for (const w in vecB) {
    normB += vecB[w] ** 2;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Classifie une question utilisateur.
 *
 * @param {string} query texte brut saisi par l'utilisateur
 * @param {{vectors, idf}} corpus résultat de buildCorpus(), calculé une fois au démarrage
 * @param {object} options { k?: number, threshold?: number }
 * @returns {{ intent: string, confidence: number, neighbors: Array }}
 */
export function classifyIntent(query, corpus, { k = 3, threshold = 0.3 } = {}) {
  const tokens = normalize(query);
  if (tokens.length === 0) {
    return { intent: "inconnue", confidence: 0, neighbors: [] };
  }

  const queryVector = tfidfVector(tokens, corpus.idf);

  const scored = corpus.vectors
    .map((v) => ({ intent: v.intent, phrase: v.phrase, score: cosineSimilarity(queryVector, v.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(k, corpus.vectors.length));

  const confidence = scored.reduce((s, v) => s + v.score, 0) / scored.length;

  if (confidence < threshold) {
    return { intent: "inconnue", confidence, neighbors: scored };
  }

  const votes = {};
  scored.forEach((v) => {
    votes[v.intent] = (votes[v.intent] || 0) + 1;
  });
  const bestIntent = Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];

  return { intent: bestIntent, confidence, neighbors: scored };
}

/** Singleton paresseux : le corpus n'est construit qu'une fois, au premier appel. */
let _cachedCorpus = null;
export function getDefaultCorpus() {
  if (!_cachedCorpus) {
    _cachedCorpus = buildCorpus(INTENTS);
  }
  return _cachedCorpus;
}
