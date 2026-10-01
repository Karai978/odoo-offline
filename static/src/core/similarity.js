/**
 * core/similarity.js
 * ===================
 * Similarité de chaînes partagée entre le module de réconciliation
 * d'entités (détection de doublons) et l'assistant NLU (résolution de
 * slots de type "entity", ex: retrouver "Rasoa" dans le cache local
 * des contacts malgré une faute de frappe ou un nom incomplet).
 *
 * Implémentation : distance de Levenshtein normalisée (ratio 0-1).
 * Choix assumé : plus simple à implémenter correctement et à auditer
 * qu'un Jaro-Winkler complet, suffisant pour des noms courts
 * (contacts, produits) — à documenter comme limite connue si les
 * tests montrent un besoin de plus de tolérance sur les inversions
 * de mots (auquel cas Jaro-Winkler serait la prochaine étape).
 */

function normalizeForCompare(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/** Distance de Levenshtein brute (nombre minimal d'éditions). */
export function levenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prevRow = Array.from({ length: n + 1 }, (_, j) => j);
  let currRow = new Array(n + 1);

  for (let i = 1; i <= m; i++) {
    currRow[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currRow[j] = Math.min(
        prevRow[j] + 1,      // suppression
        currRow[j - 1] + 1,  // insertion
        prevRow[j - 1] + cost // substitution
      );
    }
    [prevRow, currRow] = [currRow, prevRow];
  }
  return prevRow[n];
}

/**
 * Ratio de similarité normalisé entre 0 (totalement différent) et 1
 * (identique), robuste à la casse et aux accents.
 */
export function similarityRatio(a, b) {
  const normA = normalizeForCompare(a);
  const normB = normalizeForCompare(b);
  const maxLen = Math.max(normA.length, normB.length);
  if (maxLen === 0) return 1;
  const distance = levenshteinDistance(normA, normB);
  return 1 - distance / maxLen;
}

/**
 * Score de similarité "nom complet" entre une requête courte (souvent un
 * seul prénom/mot, ex: "Rasoa") et un nom complet en cache (ex: "Rasoa
 * Andriamihaja"). Une comparaison brute pénaliserait injustement la
 * différence de longueur ; on prend donc le meilleur score entre :
 *  (a) la comparaison de la requête au nom complet,
 *  (b) la comparaison de la requête à CHAQUE mot du nom complet pris isolément.
 * Ça permet de retrouver "Rasoa Andriamihaja" en tapant juste "Rasoa".
 */
export function nameMatchScore(query, fullName) {
  const wholeScore = similarityRatio(query, fullName);
  const tokenScores = fullName
    .split(/\s+/)
    .map((word) => similarityRatio(query, word));
  return Math.max(wholeScore, ...tokenScores);
}

/**
 * Trouve, parmi une liste de candidats {id, display_name}, les N
 * meilleurs par similarité avec `query`, triés par score décroissant.
 * Utilisé à la fois par le module de doublons et par l'assistant NLU
 * pour résoudre un slot "entity" contre le cache local.
 */
export function findBestMatches(query, candidates, { limit = 5, minScore = 0.4 } = {}) {
  return candidates
    .map((c) => ({ ...c, score: nameMatchScore(query, c.display_name) }))
    .filter((c) => c.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
