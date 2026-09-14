# Offline Sync — PWA Standalone
Application web progressive (PWA) indépendante nommé odoo-offline, synchronisée avec un module Odoo offline_sync
via une API JSON authentifiée par clé API.

# Arborescence finale

main.js : Point d'entrée unique
registry.js : Annuaire (catégories, séquence)
assets.js : Charge web.assets_web.min.css
name_service.js : Cache id -> display_name (many2one)
user.js : Droits/groupes utilisateur
browser/
router.js : pushState/popstate + hash
session.js : session locale + config serveur
service_worker.js : Enregistrement du service worker
bus/
bus_service.js : EventBus interne (remplace postMessage)
network/
rpc_service.js : Queue de sync offline-first + conflits
py_js/
py_utils.js : Évaluateur d'expressions Python-like
orm/
orm_service.js : Schéma IndexedDB (Dexie)
list_cache.js : Cache listes + dashboard achats
record_cache.js : Cache d'un enregistrement complet
catalog_cache.js : Cache catalogue produits
webclient/
webclient.js : Shell racine : navbar + #action-container
login.js : Contrôleur "login"
offline_prefetch_service.js : Téléchargement complet d'une app
menus/
menu_service.js : Cache des apps installées
navbar/
navbar.js : Menu horizontal (apps -> doAction)
sync_status_panel.js : Badge + panneau de synchronisation
connectivity_indicator.js : Pastille en ligne/hors ligne
home_menu/
home_menu.js : Action "home_menu" (grille des apps)
actions/
action_service.js : Routeur SPA (doAction/restoreState)
purchase_dashboard.js : Bandeau KPI Achats
views/
view.js : Dispatch générique (list_view/form_view)
view_service.js : Charge/cache le manifest module
relational_model/
relational_model.js : Réévaluation live readonly/required
dynamic_field_attrs.js : Application des attrs dynamiques
compute_engine.js : Calcul du total one2many + devise
form/
form_renderer.js : Squelette o_form_view + chatter
form_compiler.js : Compilation récursive de l'arch XML
form_controller.js : Cycle load/save + queue de sync
form_serializer.js : Collecte des valeurs du DOM
group_layout.js : Grille o_inner_group
notebook_and_header.js : Onglets, statusbar, button_box
list/
list_controller.js : Pagination, recherche, dashboard
list_renderer.js : Tableau, tri, colonnes optionnelles
list_renderer_utils.js : Formatage cellules + badges
list_column_prefs.js : Préférences colonnes (localStorage)
kanban/
kanban_renderer.js : Mini moteur QWeb pour templates kanban
fields/
field.js : Dispatcher (SUPPORTED_FIELD_WIDGETS)
char_field.js
text_field.js
integer_field.js
float_field.js
boolean_field.js
selection_field.js
date_field.js
datetime_field.js
monetary_field.js
many2one_field.js : Autocomplete + création à la volée
many2many_tags_field.js
x2many_field.js : Tableau one2many + catalogue produits
product_catalog.js

# Mécanisme SPA

1. ## main.js 
   démarre les services (`registry.category("services")`)
   appelle `loadOdooAssets()` (CSS natif Odoo) et
   `registerServiceWorker()`, puis monte `webclient.js`.

2. ## webclient.js
   construit le squelette (navbar Odoo, masquée sauf
   pour `list_view`/`form_view`), crée l'`ActionService`, et restaure l'état depuis l'URL (`router.current`) — deep link ou `home_menu` par défaut.

3. ## action_service.js
   c' est LE routeur : `doAction(descripteur)`
   démonte le contrôleur courant, en monte un nouveau dans
   `#action-container`, gère la pile de breadcrumb et synchronise l'URL via `router.pushState`/`replaceState`. Garde d'authentification intégrée (redirige vers `"login"` si pas de clé API).

4. ## views/view.js 
   dispatche vers `list_controller.js` ou
   `form_controller.js` selon la présence d'un `id`/`isNew`.

5. ## Communication interne : 
   `core/bus/bus_service.js` (EventBus)

# Odoo

## Installer
docker compose exec odoo odoo -d demo_db --db_host=db --db_port=5432 --db_user=odoo --db_password='978@308.com' -i offline_sync --stop-after-init

## Mise à jour
docker compose exec odoo odoo -d demo_db --db_host=db --db_port=5432 --db_user=odoo --db_password='978@308.com' -u offline_sync --stop-after-init

## Désinstaller un module
docker compose exec odoo sh -c "echo \"self.env['ir.module.module'].search([('name', '=', 'odoo_offline_engine')]).button_immediate_uninstall()\" | odoo shell -d demo_db --db_host=db --db_port=5432 --db_user=odoo --db_password='978@308.com' --stop-after-init"

## SHELL ODOO :
docker compose exec odoo odoo shell -d demo_db --db_host=db --db_port=5432 --db_user=odoo --db_password='978@308.com'

## régénérer le bundle 
bash scripts/build-bundle.sh

## GITHUB
git add .
git commit -m "Explication de vos modifications"
git push


#### 1 - Récupérer l'état du serveur distant 
git fetch origin

#### 2 - Réinitialiser les fichiers suivis
git reset --hard origin/main

#### 3 - Effacer les nouveaux fichiers créés
git clean -fd