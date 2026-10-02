# Universal Offline Patch (Odoo 17)

Addon unique `offline_universal_patch`, dépendant uniquement de `web`. Il intègre dans un même module les contrôleurs de bootstrap/snapshot/deltas/opérations, le journal serveur de changements, le stockage IndexedDB, les patchs des services ORM/RPC du webclient natif, une UI systray et un service worker. Le module `offline_sync` n'est ni dépendance ni cible de modification.

## État fonctionnel réel

Cette version est un **socle expérimental, pas une couverture universelle prête pour la production**.

- Le bouton systray permet de sélectionner une ou plusieurs apps visibles de l'utilisateur. Les menus hors ligne sont limités à la sélection ; le snapshot prépare les modèles directement ciblés par leurs actions de fenêtre et leurs vues natives list/form/kanban/search.
- Pour chaque modèle directement ciblé, le snapshot prend tous les enregistrements autorisés et demande les champs binaires, par pages de 200. Les modèles liés qui ne sont pas directement ciblés par une action ne sont pas encore calculés comme dépendances complètes : une sélection Ventes/Achats peut donc manquer des données nécessaires à certains formulaires ou champs relationnels.
- Le client conserve les données préparées dans IndexedDB, exécute localement un sous-ensemble ORM/CRUD, conserve une outbox avec UUID idempotents, traite les changements limités aux modèles sélectionnés et signale les divergences de `write_date`.
- Le service worker prépare le shell et les assets déjà rencontrés, puis met en cache les réponses `/web/image` et `/web/content` par utilisateur lorsqu'elles sont consultées en ligne.
- Les capacités `base`, `sale`, `purchase`, `stock`, `mail` et `custom` sont seulement des points d'extension vides. **Aucun bouton métier d'addon n'est actuellement enregistré** : une méthode sans handler local explicite échoue hors ligne au lieu d'être simulée.
- Les domaines, regroupements, onchange, widgets, vues autres que list/form/kanban/search, appels externes et politiques de conflit ne sont pas en parité complète avec Odoo. Les domaines hiérarchiques et certains regroupements (dates, many2many) sont refusés explicitement.
- La préparation peut échouer si un modèle/vue/binary ne peut pas être chargé ou si le quota navigateur est insuffisant. Les assets chargés paresseusement et les ressources binaires ne sont pas préchargés exhaustivement.
- Les données IndexedDB et le shell utilisateur ne sont pas chiffrés. Les changements SQL directs, les appels écrits en dehors de l'ORM et l'expiration/révocation connue seulement du serveur imposent une revalidation en ligne.

Par conséquent, le libellé UI indique que le **cache** est prêt ; il ne certifie pas que toutes les méthodes métier fonctionnent hors ligne. Il faut compléter et tester chaque capacité locale avant toute promesse de couverture universelle.

## Vérification

Les tests Odoo sont dans `tests/` et le test QUnit du domaine dans `static/tests/`. Ils doivent être exécutés dans un serveur Odoo 17 complet, par exemple avec `--test-tags /offline_universal_patch`. Le dépôt de travail courant ne fournit pas l'environnement Python `odoo` ; seules les vérifications syntaxiques locales peuvent être exécutées ici.
