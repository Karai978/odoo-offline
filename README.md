# Offline Sync — PWA Standalone
Application web progressive (PWA) indépendante nommé odoo-offline, synchronisée avec un module Odoo offline_sync
via une API JSON authentifiée par clé API.

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
docker compose exec odoo odoo -d demo_db --db_host=db --db_port=5432 --db_user=odoo --db_password='978@308.com' -i odooc17 --stop-after-init

## Mise à jour
docker compose exec odoo odoo -d demo_db --db_host=db --db_port=5432 --db_user=odoo --db_password='978@308.com' -u odooc17 --stop-after-init

## Désinstaller un module
docker compose exec odoo sh -c "echo \"self.env['ir.module.module'].search([('name', '=', 'odoo_offline')]).button_immediate_uninstall()\" | odoo shell -d demo_db --db_host=db --db_port=5432 --db_user=odoo --db_password='978@308.com' --stop-after-init"

echo "env['ir.module.module'].search([('name', '=', 'offline_orm')]).button_immediate_uninstall(); env.cr.commit()" | docker compose exec -T odoo odoo shell -d demo_db --db_host=db --db_port=5432 --db_user=odoo --db_password='978@308.com' --no-http

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