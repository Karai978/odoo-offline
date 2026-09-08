## Arborescence finale (`static/src/`, 59 fichiers)

```text
static/src/
├── main.js                              Point d'entrée unique
│
├── core/
│   ├── registry.js                      Annuaire (catégories, séquence)
│   ├── assets.js                        Charge web.assets_web.min.css
│   ├── name_service.js                  Cache id -> display_name (many2one)
│   ├── user.js                          Droits/groupes utilisateur
│   ├── browser/
│   │   ├── router.js                    pushState/popstate + hash
│   │   ├── session.js                   Session locale + config serveur
│   │   └── service_worker.js            Enregistrement du service worker
│   ├── bus/
│   │   └── bus_service.js               EventBus interne (remplace postMessage)
│   ├── network/
│   │   └── rpc_service.js               Queue de sync offline-first + conflits
│   ├── py_js/
│   │   └── py_utils.js                  Évaluateur d'expressions Python-like
│   └── orm/
│       ├── orm_service.js               Schéma IndexedDB (Dexie)
│       ├── list_cache.js                Cache listes + dashboard achats
│       ├── record_cache.js              Cache d'un enregistrement complet
│       └── catalog_cache.js             Cache catalogue produits
│
├── webclient/
│   ├── webclient.js                     Shell racine : navbar + #action-container
│   ├── login.js                         Contrôleur "login"
│   ├── offline_prefetch_service.js      Téléchargement complet d'une app
│   ├── menus/
│   │   └── menu_service.js              Cache des apps installées
│   ├── navbar/
│   │   ├── navbar.js                    Menu horizontal (apps -> doAction)
│   │   ├── sync_status_panel.js         Badge + panneau de synchronisation
│   │   ├── conflict_panel.js            Badge + panneau de conflits
│   │   ├── conflict_notifications.js    Toasts de nouveaux conflits
│   │   └── connectivity_indicator.js    Pastille en ligne/hors ligne
│   ├── home_menu/
│   │   └── home_menu.js                 Action "home_menu" (grille des apps)
│   └── actions/
│       ├── action_service.js            Routeur SPA (doAction/restoreState)
│       └── purchase_dashboard.js        Bandeau KPI Achats
│
├── views/
│   ├── view.js                          Dispatch générique (list_view/form_view)
│   ├── view_service.js                  Charge/cache le manifest module
│   ├── view_switcher/
│   │   └── view_switcher.js             Bascule liste/kanban/pivot/graph
│   ├── relational_model/
│   │   ├── relational_model.js          Réévaluation live readonly/required
│   │   ├── dynamic_field_attrs.js       Application des attrs dynamiques
│   │   └── compute_engine.js            Calcul du total one2many + devise
│   ├── form/
│   │   ├── form_renderer.js             Squelette o_form_view + chatter
│   │   ├── form_compiler.js             Compilation récursive de l'arch XML
│   │   ├── form_controller.js           Cycle load/save + queue de sync
│   │   ├── form_serializer.js           Collecte des valeurs du DOM
│   │   ├── group_layout.js              Grille o_inner_group
│   │   └── notebook_and_header.js       Onglets, statusbar, button_box
│   ├── list/
│   │   ├── list_controller.js           Pagination, recherche, dashboard
│   │   ├── list_renderer.js             Tableau, tri, colonnes optionnelles
│   │   ├── list_renderer_utils.js       Formatage cellules + badges
│   │   └── list_column_prefs.js         Préférences colonnes (localStorage)
│   └── kanban/
│       └── kanban_renderer.js           Mini moteur QWeb pour templates kanban
│
├── fields/
│   ├── field.js                         Dispatcher (SUPPORTED_FIELD_WIDGETS)
│   ├── char/char_field.js
│   ├── text/text_field.js
│   ├── integer/integer_field.js
│   ├── float/float_field.js
│   ├── boolean/boolean_field.js
│   ├── selection/selection_field.js
│   ├── date/date_field.js
│   ├── datetime/datetime_field.js
│   ├── monetary/monetary_field.js
│   ├── many2one/many2one_field.js       Autocomplete + création à la volée
│   ├── many2many_tags/many2many_tags_field.js
│   ├── x2many/x2many_field.js           Tableau one2many + catalogue produits
│   └── product_catalog/product_catalog.js
│
├── components/
│   └── pager/
│       └── search_pager.js              Recherche + pagination (via bus)
│
└── bundles/
    └── app.bundle.js                    Généré par esbuild — NE PAS ÉDITER
```

## Outillage de build

```bash
cd scripts && npm install   # installe esbuild (une seule fois)
bash scripts/build-bundle.sh
```

Génère `static/src/bundles/app.bundle.js` (IIFE, ES2020, avec sourcemap)
à partir de `static/src/main.js` et de son graphe d'imports complet.
`index.html` ne charge que ce fichier — jamais les sources individuelles.

## Mécanisme SPA

1. **`main.js`** démarre les services (`registry.category("services")`),
   appelle `loadOdooAssets()` (CSS natif Odoo) et
   `registerServiceWorker()`, puis monte `webclient.js`.
2. **`webclient.js`** construit le squelette (navbar Odoo, masquée sauf
   pour `list_view`/`form_view`), crée l'`ActionService`, et restaure
   l'état depuis l'URL (`router.current`) — deep link ou `home_menu` par
   défaut.
3. **`action_service.js`** est LE routeur : `doAction(descripteur)`
   démonte le contrôleur courant, en monte un nouveau dans
   `#action-container`, gère la pile de breadcrumb et synchronise l'URL
   via `router.pushState`/`replaceState`. Garde d'authentification
   intégrée (redirige vers `"login"` si pas de clé API).
4. **`views/view.js`** dispatche vers `list_controller.js` ou
   `form_controller.js` selon la présence d'un `id`/`isNew`.
5. **Communication interne** : `core/bus/bus_service.js` (EventBus)
   remplace entièrement les anciens `window.postMessage()` entre iframe
   et page parente (pager, recherche, breadcrumb, statut de sync,
   view-switcher — tout passe par `bus.trigger()`/`bus.subscribe()`).

## Historique des phases

| Phase | Contenu |
|---|---|
| 0 | Outillage `esbuild` (`scripts/package.json`, `build-bundle.sh`) |
| 1 | Socle : `registry.js`, `bus_service.js`, `router.js`, `main.js` |
| 2 | Migration ESM de `core/` (session, orm, network, py_js, user, assets) |
| 3 | `action_service.js` (vrai routeur), `login.js` (contrôleur), `webclient.js` (sans iframe) |
| 4 | Fusion `views/view.js` (list+form), moteur de vues complet, `fields/field.js` en stub |
| 5 | `fields/*` réels : split `simple_fields.js` en 9 + many2one + many2many_tags + x2many + product_catalog |
| 6 | Navbar complète, `home_menu.js`, `offline_prefetch_service.js`, `purchase_dashboard.js`, `view_switcher.js`, `search_pager.js` |
| 7 | Fusion HTML → `index.html` unique, `service-worker.js` réduit, suppression des 4 anciennes pages |
| 8 | Validation hors-ligne de bout en bout (création/modification/reconnexion/synchro) |
| 9 | Nettoyage : 46 fichiers orphelins supprimés (17 `.legacy.js` + 29 jamais migrés), ce document |

## Bugs réels détectés et corrigés pendant la migration

Cette section documente les régressions/anomalies trouvées par les tests
de bout en bout à chaque phase — pas de simple copier-coller, chaque
phase a été validée par exécution réelle (Node `vm`/`jsdom`), pas
seulement par relecture.

1. **`loadOdooAssets()` jamais appelée** (créée Phase 2, appelée seulement
   Phase 7) — sans ce correctif, l'app entière se serait affichée sans
   aucun style Odoo natif (`.o_form_view`, `.o_list_table`, `.o_navbar`...).
2. **`core/browser/sw-register.js` jamais migré en ESM** malgré le plan
   initial — rattrapé en Phase 7 (`core/browser/service_worker.js`).
3. **Bouton "Nouveau" et lien de breadcrumb cassés** (Phase 6) — le
   descripteur d'action reconstruit à partir de `params` du bus omettait
   le champ `tag` (déjà extrait par `action_service.js` avant émission de
   l'événement `action:changed`), donc `doAction()` échouait silencieusement.
4. **Synchronisation envoyée en double à la reconnexion** (détecté Phase 8)
   — `core/network/rpc_service.js` ET `sync_status_panel.js` avaient chacun
   leur propre `window.addEventListener("online", ...)` déclenchant
   `syncPendingActions()` sans coordination. Corrigé en retirant le
   listener de la couche réseau (qui n'expose plus qu'une capacité, pas
   un déclencheur autonome — cohérent avec le vrai `rpc_service.js` natif).
5. **Badge "en attente" jamais rafraîchi après une sauvegarde hors-ligne**
   (détecté Phase 8) — `bus.trigger("sync:updated")` n'était émis que
   dans la branche `if (navigator.onLine)` de `form_controller.js`.
6. **Variable globale implicite `currentModel`** (Phase 5) dans l'ancien
   `one2many_field.js`, incompatible avec les modules ES — remplacée par
   un attribut `data-model` posé sur le formulaire par `form_controller.js`.
7. **`SUPPORTED_FIELD_WIDGETS` vivait dans `view_renderer.js`** par effet
   de portée globale partagée (Phase 5) — rapatrié dans `fields/field.js`,
   son vrai propriétaire logique.

## Anomalie découverte, non corrigée silencieusement

`css/pwa-shell-overrides.css` et `css/purchase-requests.css` étaient
précachés par l'ancien service worker mais **n'étaient référencés dans
aucun HTML ni JS** de tout le projet d'origine — un oubli de liaison
préexistant. Ajoutés dans `index.html` en Phase 7 (comportement le plus
sûr : sans effet si inutilisés, corrige un défaut visuel sinon).

## Limites connues / dette assumée

- Les vues **pivot** et **graph** ne sont pas implémentées (placeholder
  "à venir" dans `list_controller.js`), comme dans l'app d'origine.
- `fields/x2many/x2many_field.js` et `fields/product_catalog/product_catalog.js`
  sont des migrations fidèles de l'original, pas une réécriture complète
  façon Odoo natif (qui découpe ce moteur en plusieurs fichiers dans le
  vrai addon `product`).
- Validation du **`service-worker.js`** (Cache API réelle) faite
  uniquement par relecture statique du code — aucun vrai navigateur
  disponible dans cet environnement de développement. Un test manuel
  (Chrome DevTools → Application → Service Workers → case "Offline")
  reste recommandé avant mise en production.
- Les tests de bout en bout de chaque phase utilisent un faux `Dexie`
  (fidèle au schéma réel `"++id, ..."` depuis la Phase 8) plutôt qu'une
  vraie IndexedDB, faute de navigateur disponible dans cet environnement.

  # GITHUB
  C'est un excellent moyen de pratiquer ! Voici un exercice pas à pas pour modifier votre fichier `ARCHITECTURE.md` et envoyer la modification sur GitHub.

---

1. **1. Modifier le fichier dans VS Code:**
Ouvrez le fichier `ARCHITECTURE.md` dans votre éditeur et ajoutez une ligne à la fin (par exemple : `# Test de mise à jour Git`), puis enregistrez le fichier (`Ctrl + S`).


2. **2. Observer la détection de Git:**
Dans votre terminal, tapez la commande de suivi :

```bash
git status

```

*Pour vérifier :* Git affiche le fichier `ARCHITECTURE.md` **en rouge**, indiquant qu'il a détecté la modification.


3. **3. Indexer le fichier (git add):**
Préparez la modification pour le commit :

```bash
git add ARCHITECTURE.md

```

*Pour vérifier :* Exécutez à nouveau `git status`. Le nom du fichier apparaît désormais **en vert**.


4. **4. Enregistrer la modification (git commit):**
Validez votre changement localement avec un message descriptif :

```bash
git commit -m "docs: mise à jour du fichier ARCHITECTURE.md"

```

*Pour vérifier :* Tapez `git log -1` pour voir votre nouveau commit enregistré dans l'historique local.


5. **5. Publier la modification (git push):**
Envoyez le commit vers votre dépôt GitHub privé :

```bash
git push

```

*Pour vérifier :* Rendez-vous sur la page GitHub de votre dépôt `odoo-offline` et ouvrez le fichier `ARCHITECTURE.md` pour constater la mise à jour en ligne !


---
