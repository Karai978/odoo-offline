/**
 * model/rules_engine/rules/domain_rules.js
 * ===========================================
 * Règles de domaine :
 *  - "purchase_dashboard_state" : classification métier nommée (à
 *    envoyer / en attente / en retard), déplacée depuis
 *    views/purchase_dashboard.js::buildPurchaseDashboardDomain() --
 *    utilisée à la fois par le bandeau du dashboard et par le filtrage
 *    de la liste (views/list/list_controller.js), qui dupliquaient la
 *    même logique.
 *  - "generic_record_rule" (ir.rule) : jusqu'ici, security_info.record_rule_domain
 *    était récupéré et mis en cache par core/user_service.js mais n'était
 *    JAMAIS appliqué (voir audit) -- les enregistrements en cache local
 *    n'étaient filtrés par aucune règle de confidentialité par
 *    enregistrement. Cette règle générique corrige ce trou.
 */

import { matchesDomain } from "../../../core/py_js/py_utils.js";

// Dédoublonnage des warnings (un seul par modèle+champ, pas un par ligne
// de liste affichée) -- évite le spam constaté en pratique.
const warnedOnce = new Set();
function warnOnce(key, ...args) {
  if (warnedOnce.has(key)) return;
  warnedOnce.add(key);
  console.warn(...args);
}

/**
 * Extrait les noms de champs des VRAIES feuilles d'un domaine Odoo
 * ([field, op, value], toujours un tableau de longueur 3 dont le premier
 * élément est une chaîne). Les opérateurs préfixes '&'/'|'/'!' sont de
 * simples chaînes au niveau racine du tableau -- il ne faut surtout pas
 * les déstructurer comme [field] = '&' (ce qui donnait "&" en tant que
 * "nom de champ", d'où le faux positif observé sur les domaines avec
 * '&'/'|').
 */
function extractLeafFields(domain) {
  return domain
    .filter((token) => Array.isArray(token) && token.length === 3 && typeof token[0] === "string")
    .map((leaf) => leaf[0]);
}

export const domainRules = [
  {
    model: "purchase.order",
    type: "domain",
    name: "purchase_dashboard_state",
    // params: { rowKey: "toutes"|"mes", stateKey: "a_envoyer"|"en_attente"|"en_retard", userId }
    // Mirroir exact de la logique backend (purchase_dashboard controller).
    evaluate({ rowKey, stateKey, userId }) {
      let domain;
      if (stateKey === "a_envoyer") {
        domain = [["state", "=", "draft"]];
      } else if (stateKey === "en_attente") {
        domain = [["state", "=", "sent"]];
      } else {
        const today = new Date().toISOString().slice(0, 10);
        domain = [["state", "in", ["draft", "sent"]], ["date_order", "<", today]];
      }
      if (rowKey === "mes" && userId) {
        domain.push(["user_id", "=", userId]);
      }
      return domain;
    },
  },
  {
    model: "*",
    type: "domain",
    subtype: "record_rule",
    name: "generic_record_rule",
    // record: l'enregistrement à tester
    // securityInfo: { record_rule_domain } (voir core/user_service.js)
    evaluate(record, securityInfo) {
      const domain = securityInfo && securityInfo.record_rule_domain;
      if (!domain || domain.length === 0) return true; // pas de record rule -- rien à filtrer

      // Les champs many2one sont représentés dans les données de liste sous
      // forme de tuple [id, "Libellé"] (convention Odoo classique, déjà
      // utilisée ailleurs dans ce projet -- voir list_renderer_utils.js et
      // py_utils.js::resolveParentReferences). Un record_rule_domain
      // (ex: [["company_id", "in", [1, 2]]]) compare toujours contre des
      // IDs, donc on désenveloppe le tuple avant comparaison -- sinon
      // "[1,2].includes([1,'Ma Société'])" échoue systématiquement même
      // quand le champ est bien présent.
      const normalizedRecord = { ...record };
      for (const [key, value] of Object.entries(normalizedRecord)) {
        if (Array.isArray(value) && value.length === 2 && typeof value[0] === "number" && typeof value[1] === "string") {
          normalizedRecord[key] = value[0];
        }
      }

      // Garde-fou : si le domaine référence un champ absent du record (ex:
      // "company_id" non inclus dans les colonnes de la vue liste), on ne
      // peut pas trancher sans risquer de vider la liste à tort -- la vraie
      // sécurité reste de toute façon appliquée côté serveur au moment du
      // téléchargement. On ne regarde QUE les vraies feuilles (pas les
      // opérateurs '&'/'|'/'!' -- voir extractLeafFields), et on ne log
      // qu'une fois par modèle+champ pour éviter le spam.
      const missingField = extractLeafFields(domain).find((field) => !(field in normalizedRecord));
      if (missingField) {
        warnOnce(
          `${securityInfo.model || "?"}:${missingField}`,
          `[rules_engine] record_rule ignorée sur "${securityInfo.model || "?"}" : ` +
          `le champ "${missingField}" référencé par record_rule_domain n'est pas ` +
          `présent dans les données de la liste.`,
          domain
        );
        return true;
      }

      // Détection du placeholder Odoo "deny all" ([(0, '=', 1)]) -- légitime
      // si vraiment aucune ir.rule ne s'applique à cet utilisateur, mais vu
      // que ce champ n'était jamais consommé côté client avant aujourd'hui,
      // ça peut aussi être un backend pas encore terminé côté
      // /offline_sync/security_info. Log explicite pour trancher vite.
      if (domain.length === 1 && domain[0][0] === 0 && (domain[0][1] === "=" || domain[0][1] === "==") && domain[0][2] === 1) {
        warnOnce(
          `${securityInfo.model || "?"}:deny-all`,
          `[rules_engine] record_rule_domain = [(0,'=',1)] (deny-all) reçu -- ` +
          `si ce n'est pas voulu, vérifie l'endpoint /offline_sync/security_info côté backend.`,
          securityInfo
        );
      }

      return matchesDomain(normalizedRecord, domain);
    },
  },
];