# Cible « hors-ligne universel » — état des lieux et architecture

**Statut :** cadrage et critères d'acceptation. Un prototype de l'addon `offline_universal_patch` existe maintenant, mais il ne satisfait pas encore la couverture universelle et n'est pas prêt pour la production.

**Périmètre confirmé par le métier :** toutes les apps et tous les modèles ; vues liste, formulaire et kanban ; lecture, création, modification et suppression ; boutons et méthodes métier exécutés localement pendant la déconnexion ; toutes les données.

Ce document s'appuie sur l'audit du dépôt PWA présent et sur l'inspection du webclient Odoo 17. L'état de code courant et ses limites sont récapitulés dans `offline_universal_patch/README.md`.

## 1. Définition opérationnelle de la cible

L'expérience hors ligne ne doit pas être une interface parallèle ou une simple file de requêtes. Après une préparation complète de l'appareil, l'utilisateur doit pouvoir :

- ouvrir les apps et modèles auxquels son compte a accès, sans réseau ;
- utiliser leurs vues liste, formulaire et kanban sur les données locales ;
- rechercher, filtrer, trier et naviguer dans les données synchronisées ;
- créer, lire, modifier et supprimer des enregistrements localement ;
- exécuter localement chaque action ou méthode métier déclarée comme disponible hors ligne ;
- retrouver ses changements après fermeture/rechargement, puis les synchroniser et résoudre les divergences au retour du réseau.

**Interprétation de « toutes les données » :** tous les enregistrements autorisés pour l'utilisateur connecté, selon les règles et sociétés Odoo, avec les relations et données associées nécessaires — y compris les pièces jointes, messages du chatter et activités lorsqu'ils appartiennent au parcours fonctionnel. Cela ne signifie pas répliquer les données auxquelles cet utilisateur n'a pas accès.

L'appareil ne sera déclaré **prêt hors ligne** qu'une fois le catalogue, les assets requis, les données du périmètre autorisé et les capacités métier locales présents et vérifiés. Un téléchargement partiel ne doit pas être présenté comme universel.

## 2. Matrice de couverture actuelle

| Domaine | État constaté dans la PWA | Écart avec la cible |
|---|---|---|
| Apps et modèles | **Partiel.** `offline_prefetch_service.js` télécharge le manifest et les modèles d'une app choisie ; les menus installés peuvent être mis en cache. | Pas de garantie que toutes les apps soient préparées. La couverture dépend des manifests et des menus exposés par l'addon. |
| Métadonnées, vues et champs | **Partiel.** `view_service.js` conserve localement les manifests, architectures XML et champs transmis pour un module. | Pas encore une description complète/versionnée de toutes les actions, widgets, composants JS et extensions de tous les addons. |
| Lecture et listes | **Partiel.** `list_cache.js` met en cache des listes par modèle/action ; `record_cache.js` conserve les fiches renvoyées ; les références sont préchargées. Le backend audité plafonne par défaut une requête de liste à environ 80 lignes. | Ce n'est pas une réplication exhaustive, ni une pagination/synchronisation complète garantie. Une fiche absente du cache n'est pas lisible hors ligne. |
| Vues liste | **Partiel.** Une liste DOM personnalisée prend en charge pagination locale, tri et recherche simplifiée sur les données déjà chargées. | Comportements et domaines ne sont pas ceux du moteur natif complet ; les enregistrements non chargés manquent. |
| Vues formulaire | **Partiel.** Formulaire personnalisé, champs courants et certains champs relationnels ; les fiches préchargées peuvent être consultées et modifiées. | Widgets, calculs, onchange, domaines, contraintes et comportements d'addons ne sont pas tous reproduits. |
| Vues kanban | **Partiel/basique.** `kanban_renderer.js` et `kanban_compiler.js` interprètent un sous-ensemble de QWeb. | Pas de parité garantie avec les composants, interactions, regroupements et extensions kanban natifs. |
| Création | **Partiel, présent.** Une création est ajoutée à `sync_queue`, reflétée localement avec un ID temporaire, puis envoyée au serveur. | Références et dépendances entre créations ne sont pas gérées comme un ORM local universel. |
| Modification | **Partiel, présent.** Les changements sont optimistes et mis en file ; le mécanisme existant sait signaler certains conflits d'écriture. | La règle est centrée sur les fiches et payloads gérés par la PWA, pas sur toutes les mutations possibles du webclient. |
| Suppression | **Partiel.** Le formulaire sait sérialiser la suppression de lignes `one2many`. | Aucun parcours UI général de suppression d'un enregistrement principal n'a été trouvé, même si la file/backend connaît l'opération `unlink`. |
| Boutons/méthodes métier | **Différé, pas hors ligne au sens demandé.** Certains boutons `type="object"` sont mis en file puis exécutés par le serveur après reconnexion. | Aucun exécuteur local générique ; arguments/contexte incomplets ; `type="action"`, assistants et étapes supplémentaires non couverts. |
| Règles et calculs | **Partiel.** Quelques règles locales explicites existent, dont des cas `sale.order`. | La plupart des méthodes Python, calculs, onchange et validations serveur ne sont pas exécutés localement. |
| Chatter, activités et pièces jointes | **Absent ou placeholder.** Le chatter du formulaire indique que l'historique n'est pas disponible hors ligne et ses boutons signalent le besoin de connexion. | Il faut synchroniser et traiter ces données/fichiers explicitement ; le cache des fiches ne suffit pas. |
| Shell et interface native | **PWA autonome.** Le service worker cache le shell et les assets de cette PWA ; les appels `/offline_sync/` ne sont pas servis par ce cache. Les vues sont des renderers maison. | Ce n'est pas encore une intégration au webclient natif Odoo ni à ses services, composants Owl et widgets. |
| Sécurité locale | **Partiel.** Des droits par modèle sont cachés et un changement d'utilisateur peut purger le cache. | Les permissions et règles peuvent changer pendant une déconnexion ; elles doivent être revalidées au retour en ligne. Les données locales exigent une politique de protection et de purge. |

**Conclusion :** la PWA est un prototype offline-first utile (cache, file, synchronisation, conflits), mais ne couvre pas l'objectif universel, notamment l'exécution locale des méthodes, la complétude des données et la parité du webclient.

## 3. Architecture cible proposée

Le webclient natif reste responsable de l'interface. La capacité offline se place sous ses composants, au niveau des services de données, de synchronisation et d'exécution des actions — pas en remplaçant progressivement chaque écran par un renderer autonome.

```text
Webclient natif Odoo (actions, vues, widgets, composants)
                         │
          services ORM/RPC compatibles offline
             ┌───────────┴────────────┐
             │ connecté               │ hors ligne
             ▼                        ▼
       Odoo serveur            moteur de données local
             │                  + exécuteurs métier locaux
             └──── protocole de synchronisation ────┘
                         │
       IndexedDB : snapshots, index, pièces jointes,
       journal transactionnel, états et versions
```

### 3.1 Catalogue de capacités hors ligne

L'addon serveur publie un manifeste versionné pour le compte courant : apps, modèles, champs, relations, actions, architectures de vues, permissions, règles de domaine/société, assets et versions des extensions. Les addons déclarent aussi leurs capacités offline : vues/widgets pris en charge, dépendances de données et exécuteurs locaux des méthodes/actions.

Le manifeste ne rend pas une méthode Python exécutable dans le navigateur. Pour chaque bouton/méthode, il faut une implémentation cliente ou un code portable partagé, associé à un contrat versionné : modèle/méthode, arguments et contexte, données requises, résultat local, mutations produites et stratégie de réconciliation. Une capacité manquante empêche de déclarer l'app universellement prête.

### 3.2 Réplication complète et persistante

Le serveur fournit un instantané paginé et reprenable des données autorisées, puis un flux de changements incrémentaux (créations, modifications, suppressions/tombstones) avec curseur/version. La préparation couvre également les relations, références, métadonnées nécessaires aux vues, chatter/activités et pièces jointes. Le client vérifie l'intégrité et la complétude avant d'activer l'état « prêt hors ligne ».

Une base entière peut dépasser le quota ou l'espace de stockage d'un navigateur. La promesse « toutes les données » doit donc être qualifiée par un profil d'appareil et une taille maximale mesurée ; en cas d'insuffisance, l'application doit refuser d'annoncer la préparation complète plutôt que masquer des données manquantes.

### 3.3 ORM local derrière les services natifs

Les vues natives continuent d'appeler les services Odoo. Un adaptateur offline route les opérations de données vers un moteur local transactionnel quand il n'y a pas de réseau. Celui-ci doit prendre en charge les sémantiques réellement utilisées : lecture/écriture/création/suppression, relations, domaines, contexte, tri, pagination et droits locaux.

Il ne faut pas intercepter globalement les requêtes HTTP en leur fabriquant des réponses RPC génériques : tous les appels ne sont pas des requêtes ORM, et une réponse artificielle pourrait faire croire qu'une action serveur a réussi. Chaque famille d'appel doit être explicitement reliée à un fournisseur local, à un exécuteur métier ou à un état « non couvert ».

### 3.4 Exécution métier et journal de mutations

En mode offline, le gestionnaire d'actions résout les boutons/actions depuis le registre de capacités, exécute la logique locale et applique immédiatement ses mutations dans une transaction locale. Les effets et mutations sont enregistrés dans un journal durable, avec identifiants idempotents, dépendances entre opérations et correspondance des IDs temporaires.

Au retour du réseau, le serveur valide et applique ces intentions une seule fois, renvoie les IDs réels, les changements de référence et les divergences ; le client met à jour son état local. Les conflits nécessitent des politiques définies par modèle/champ/action, au-delà d'une simple comparaison générique de dates.

Une limite physique demeure : un envoi de courriel, un paiement auprès d'un prestataire, un appel transporteur ou toute autre interaction distante ne peut pas produire son effet externe sans réseau. Le parcours local peut s'exécuter et enregistrer l'intention ; l'effet externe sera nécessairement réalisé lors de la synchronisation. Il faut le distinguer clairement d'une exécution externe immédiate.

### 3.5 Sécurité et cycle de vie

Les snapshots respectent les ACL, règles d'enregistrement et sociétés du compte. Le stockage local doit prévoir chiffrement/protection de session, verrouillage, purge au changement de compte ou à la déconnexion, et revalidation des droits à la reconnexion. Une révocation de droits pendant une longue période offline ne peut pas être connue de l'appareil avant sa reconnexion ; la durée de validité d'une session offline et le risque associé doivent être décidés explicitement.

## 4. Critères d'acceptation proposés

La couverture n'est déclarée universelle que si, pour chaque app/modèle/action inclus :

1. le webclient natif démarre et se recharge sans réseau après préparation ;
2. tous les enregistrements du périmètre autorisé et leurs dépendances sont présents, consultables et cohérents localement ;
3. liste, formulaire et kanban natives restent utilisables sur cet ensemble de données ;
4. create/read/write/unlink sont exécutés localement, survivent à un rechargement et se synchronisent sans doublon ;
5. chaque bouton/action/méthode a un exécuteur offline testé, ou l'app n'est pas déclarée complète ;
6. les divergences, refus serveur et changements de permissions sont visibles et récupérables ;
7. les scénarios sont validés avec zéro requête réseau pendant la phase réellement offline, puis avec une synchronisation interrompue/reprise ;
8. les pièces jointes, chatter et activités inclus au périmètre sont lisibles et leurs mutations suivent le même cycle local/synchronisation.

La matrice de validation devra être générée à partir de l'installation réelle : `app × modèle × vue × opération × action/méthode × widget × dépendance`. Une couverture universelle signifie que chaque case requise est prise en charge ou explicitement bloquante — pas qu'un seul modèle de démonstration fonctionne.

## 5. Étapes de réalisation recommandées

1. **Spike webclient natif (sans modifier les vues).** Vérifier la version exacte déployée, les services ORM/RPC et appels directs, les points d'extension réellement stables, ainsi que le chargement des assets natifs par service worker.
2. **Contrat serveur et mesure de données.** Définir le manifeste, les instantanés/deltas, la gestion des suppressions et pièces jointes ; mesurer volume, temps, quotas et reprise sur les bases représentatives.
3. **Moteur local commun.** Construire le magasin transactionnel et le protocole de mutations/idempotence/conflits ; tester parité des opérations ORM et domaines.
4. **Intégration UI native.** Brancher les services natifs existants sur ce moteur sans remplacer les renderers natifs ; commencer avec un flux vertical représentatif.
5. **Registre des méthodes métier.** Porter et tester les méthodes/actions des addons. Étendre progressivement jusqu'à couvrir toute l'installation avant de revendiquer l'universalité.
6. **Élargissement et qualification.** Couvrir tous les modèles/vues/widgets/actions, les droits et les données associées ; tests de coupure réseau, reprise, conflits, stockage et changement d'utilisateur.

## 6. Portes techniques avant toute revendication de couverture ou mise en production

- Confirmer le commit/version exacte du webclient déployé : le dépôt courant est la PWA, pas le dépôt complet du serveur Odoo ; l'inspection d'un module `web` Odoo 17 ne remplace pas un test sur le serveur cible.
- Vérifier que tous les modules tiers/custom peuvent fournir leurs assets et exécuteurs offline ; sans modification ou extension de leur logique serveur, leurs méthodes Python ne seront pas universellement exécutables localement.
- Fixer les limites d'appareils et volumes compatibles, ainsi que la politique de session et de données locales.
- Compléter et valider un flux vertical sur un modèle métier avec relation, vues natives, onchange, synchronisation et méthode locale ; le tester avec perte réseau, redémarrage, conflit et réconciliation.

Tant que ces portes ne sont pas franchies et que la matrice app/modèle/vue/méthode n'est pas couverte, le prototype ne doit pas être présenté comme une solution universelle.
