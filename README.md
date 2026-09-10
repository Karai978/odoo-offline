cat > README.md << 'EOF'
# Offline Sync — PWA Standalone

Application web progressive (PWA) indépendante, synchronisée avec un module Odoo
via une API JSON authentifiée par clé API.

## Structure

- `index.html` / `login.html` — pages de l'application
- `js/` — logique applicative (config, base locale, synchronisation, UI)
- `lib/` — dépendances tierces (Dexie.js pour IndexedDB)
- `css/` — styles
- `assets/` — icônes PWA
- `manifest.json` — manifeste PWA (nom, icônes, mode d'affichage)
- `service-worker.js` — cache offline et interception réseau

## Lancer en local

```bash
python3 -m http.server 8080
```

## Configuration

Modifier `js/config.js` pour pointer vers l'URL de l'instance Odoo cible.
L'authentification se fait via email/mot de passe Odoo (page de login),
qui récupère automatiquement la clé API associée à l'utilisateur.

controllers/
├── __init__.py
├── common.py               ← Mixin : constantes + _cors_response + _authenticate_api_key + _json_safe
├── auth_controller.py       ← login
├── dashboard_controller.py  ← dashboard_info, app_info
├── metadata_controller.py   ← module_manifest, installed_apps, model_fields, security_info,
│                                _guess_main_model, _get_icon_base64, _get_synced_models
├── database_controller.py   ← reference_records, list_records, read_record
└── sync_controller.py       ← push_actions (le vrai Sync Engine, maintenant tout petit)

PWA (IndexedDB, table sync_queue locale)
        │
        │  synchronisation (push_actions dans sync_controller.py)
        ▼
Odoo (sync.queue, table PostgreSQL) ← C'EST CE FICHIER
        │
        │  apply_action()
        ▼
Le vrai enregistrement Odoo (res.partner, sale.order, stock.quant...)

docker compose exec odoo odoo shell -d demo_db --db_host=db --db_port=5432 --db_user=odoo --db_password='978@308.com'

Désinstaller un module
docker compose exec odoo sh -c "echo \"self.env['ir.module.module'].search([('name', '=', 'odoo_offline_engine')]).button_immediate_uninstall()\" | odoo shell -d demo_db --db_host=db --db_port=5432 --db_user=odoo --db_password='978@308.com' --stop-after-init"

docker compose exec odoo sh -c "echo \"self.env['ir.module.module'].search([('name', '=', 'offline_vlr')]).button_immediate_uninstall()\" | odoo shell -d demo_db --db_host=db --db_port=5432 --db_user=odoo --db_password='978@308.com' --stop-after-init"

Installer
docker compose exec odoo odoo -d demo_db --db_host=db --db_port=5432 --db_user=odoo --db_password='978@308.com' -i offline_sync --stop-after-init

docker compose exec odoo odoo -d demo_db --db_host=db --db_port=5432 --db_user=odoo --db_password='978@308.com' -u offline_vlr --stop-after-init

Mise à jour
docker compose exec odoo odoo -d demo_db --db_host=db --db_port=5432 --db_user=odoo --db_password='978@308.com' -u offline_sync --stop-after-init

my_offline_addon : claude
my_offline_engine : chatGPT
db.sync_queue.toArray().then(rows => console.log(rows));

docker compose exec odoo sh -c 'grep -rl "OuterGroup" $(find / -type d -path "*addons/web/static/src" 2>/dev/null | head -1)'

docker compose exec odoo -u offline_sync --stop-after-init

SHELL ODOO :
docker compose exec odoo odoo shell -d demo_db --db_host=db --db_port=5432 --db_user=odoo --db_password='978@308.com'

4. Intégrer ça dans ta méthode de travail habituelle

À chaque fois que tu modifies un des fichiers JS listés dans FILES, il faut relancer ./scripts/build-bundle.sh avant de recharger la page — sinon dashboard.html chargera un bundle obsolète. Ça s'ajoute à ton ordre existant :

sauvegarde fichier(s) → régénérer le bundle 
(./scripts/build-bundle.sh) 
→ restart Docker si backend touché 
→ Unregister SW + vider Cache/Dexie si nécessaire → recharger

bash scripts/build-bundle.sh

docker compose exec odoo sh -c 'tar -czf /tmp/odoo_web.tar.gz -C /usr/lib/python3/dist-packages/odoo/addons web' && docker cp $(docker compose ps -q odoo):/tmp/odoo_web.tar.gz ~/Documents/

docker compose exec odoo rm -f /tmp/odoo_web.tar.gz

```bash
cd scripts && npm install   # installe esbuild (une seule fois)
bash scripts/build-bundle.sh
```