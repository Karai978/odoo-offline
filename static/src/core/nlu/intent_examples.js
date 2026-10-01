/**
 * core/nlu/intent_examples.js
 * ============================
 * Corpus d'entraînement de l'assistant NLU + schéma des slots par intention.
 *
 * Règle pratique : 15 à 30 phrases par intention, en variant la STRUCTURE
 * syntaxique (affirmative / interrogative / impérative) et le VOCABULAIRE
 * (synonymes) — c'est la variété de formulation qui rend le classifieur
 * robuste, pas le nombre brut de phrases.
 *
 * Chaque slot déclare son mode d'extraction (voir slot_extractor.js) :
 *   - "enum"       : correspondance sur une liste fermée de valeurs connues
 *   - "entity"     : résolution floue contre un cache local (ex: res.partner)
 *   - "date_range" : extraction par règles/regex (ex: "ce mois-ci", "hier")
 */

export const INTENTS = {
  recherche_liste: {
    description: "Rechercher une liste d'enregistrements filtrée (commandes, factures...)",
    examples: [
      "montre les commandes en attente de Rasoa",
      "montre-moi les commandes en attente",
      "liste des commandes confirmées",
      "quelles commandes ont été validées ce mois-ci",
      "affiche les factures impayées",
      "je veux voir les devis de Rakoto",
      "donne-moi les commandes du mois dernier",
      "quelles sont les commandes en cours",
      "affiche-moi la liste des devis",
      "montre les factures de Rasolofo",
      "quelles commandes sont encore en brouillon",
      "je cherche les commandes validées",
      "liste des factures payées",
      "affiche toutes les commandes de ce client",
      "quelles commandes attendent une confirmation",
      "montre-moi les devis en attente",
      "donne la liste des factures de ce mois",
      "quelles commandes ont été annulées",
    ],
    slots: {
      model: {
        type: "enum",
        values: {
          commande: "sale.order",
          commandes: "sale.order",
          devis: "sale.order",
          facture: "account.move",
          factures: "account.move",
        },
      },
      client: { type: "entity", source: "res.partner" },
      statut: {
        type: "enum",
        values: {
          "en attente": "draft",
          "en cours": "draft",
          "brouillon": "draft",
          "confirmée": "sale",
          "confirmées": "sale",
          "validée": "sale",
          "validées": "sale",
          "annulée": "cancel",
          "annulées": "cancel",
          "payée": "paid",
          "payées": "paid",
          "impayée": "not_paid",
          "impayées": "not_paid",
        },
      },
      periode: { type: "date_range" },
    },
  },

  recherche_fiche: {
    description: "Ouvrir directement une fiche précise (client, produit, commande...)",
    examples: [
      "ouvre la fiche de Rakoto",
      "affiche le client Rasolofo",
      "va sur la commande SO1042",
      "montre-moi le produit savon noir",
      "ouvre le contact Rasoa",
      "je veux voir la fiche de Rabe",
      "affiche la commande numéro 1042",
      "montre le fournisseur Andria",
      "ouvre le produit riz blanc",
      "va sur la fiche client de Rasolofo",
      "affiche les détails de Rakoto",
    ],
    slots: {
      model: {
        type: "enum",
        values: {
          client: "res.partner",
          contact: "res.partner",
          fournisseur: "res.partner",
          produit: "product.product",
          commande: "sale.order",
        },
      },
      nom: { type: "entity", source: "dynamic" }, // résolu selon le modèle détecté
    },
  },

  etat_sync: {
    description: "Consulter l'état de la file de synchronisation (actions en attente / en erreur)",
    examples: [
      "j'ai combien d'actions en attente de synchro",
      "où en est la synchronisation",
      "combien d'erreurs de synchro",
      "est-ce que tout est synchronisé",
      "y a-t-il des actions en erreur",
      "combien de modifications en attente d'envoi",
      "la synchro a-t-elle fonctionné",
      "montre-moi les erreurs de synchronisation",
      "est-ce que mes modifications sont envoyées",
      "statut de la file de synchronisation",
    ],
    slots: {},
  },

  explication_conflit: {
    description: "Comprendre un conflit de synchronisation détecté",
    examples: [
      "pourquoi ce conflit a été détecté",
      "explique-moi ce conflit",
      "qu'est-ce qui n'a pas pu être synchronisé",
      "montre les conflits en attente",
      "quels sont les conflits de synchronisation",
      "pourquoi cette commande n'a pas été envoyée",
      "y a-t-il des conflits à résoudre",
      "détaille les conflits en cours",
    ],
    slots: {},
  },

  kpi_achats: {
    description: "Consulter le tableau de bord / les indicateurs Achats",
    examples: [
      "combien de commandes fournisseurs ce mois",
      "montre le tableau de bord achats",
      "quel est le montant total des achats",
      "affiche les indicateurs achats",
      "combien de bons de commande en cours",
      "donne-moi les KPI achats",
      "résumé des achats du mois",
    ],
    slots: {},
  },
};

/** Liste des mots vides français à ignorer lors de la normalisation. */
export const STOPWORDS = new Set([
  "le", "la", "les", "l", "un", "une", "des", "de", "du", "d",
  "et", "ou", "mais", "donc", "or", "ni", "car",
  "que", "qui", "quoi", "où", "quel", "quelle", "quels", "quelles",
  "ce", "ces", "cet", "cette",
  "je", "tu", "il", "elle", "nous", "vous", "ils", "elles", "on",
  "mon", "ma", "mes", "ton", "ta", "tes", "son", "sa", "ses",
  "pour", "par", "avec", "sans", "sur", "sous", "dans", "entre",
  "est", "sont", "a", "ai", "as", "avons", "avez", "ont",
  "ne", "pas", "plus", "moins",
  "y", "en",
]);
