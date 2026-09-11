/**
 * core/orm_service.js
* This file defines the schema for the local IndexedDB database used 
 * by the application to support offline mode. 
 * It relies on the Dexie.js library.
 */

export const db = new Dexie("offline_sync_db");


// Version 1 (existante, ne pas modifier une version déjà publiée)
db.version(1).stores({
  sync_queue: "++id, local_uuid, status, model_name, created_at",
});

// Version 2 : ajout de la table des droits (Security Engine)
db.version(2).stores({
  sync_queue: "++id, local_uuid, status, model_name, created_at",
  // model = clé primaire (un enregistrement par modèle Odoo)
  security_info: "model, updated_at",
});

// Version 3 : ajout du cache des modules installés
db.version(3).stores({
  sync_queue: "++id, local_uuid, status, model_name, created_at",
  security_info: "model, updated_at",
  // technical_name = clé primaire (un enregistrement par module Odoo)
  installed_apps: "technical_name",
});

// Version 4 : cache des enregistrements de référence (pour Many2one)
db.version(4).stores({
  sync_queue: "++id, local_uuid, status, model_name, created_at",
  security_info: "model, updated_at",
  installed_apps: "technical_name",
  // clé composée : un enregistrement par (modèle + id)
  reference_records: "[model+id], model",
});

// Version 5 : cache des manifests de modules (views + fields + menus)
db.version(5).stores({
  sync_queue: "++id, local_uuid, status, model_name, created_at",
  security_info: "model, updated_at",
  installed_apps: "technical_name",
  reference_records: "[model+id], model",
  // technical_name = clé primaire (un manifest complet par module)
  module_manifests: "technical_name, updated_at",
});

db.version(6).stores({
  sync_queue: "++id, local_uuid, status, model_name, created_at",
  security_info: "model, updated_at",
  installed_apps: "technical_name",
  reference_records: "[model+id], model",
  module_manifests: "technical_name, updated_at",
  // Liste des enregistrements d'un modèle (une entrée par modèle)
  list_cache: "model, updated_at",
  // Un enregistrement complet, pour l'édition offline
  record_cache: "[model+record_id], model",
});

// Version 7 : cache du bandeau de statistiques (dashboard) par app
db.version(7).stores({
  sync_queue: "++id, local_uuid, status, model_name, created_at",
  security_info: "model, updated_at",
  installed_apps: "technical_name",
  reference_records: "[model+id], model",
  module_manifests: "technical_name, updated_at",
  list_cache: "model, updated_at",
  record_cache: "[model+record_id], model",
  // key = identifiant du dashboard (ex: "purchase_order"), un seul par app pour l'instant
  dashboard_cache: "key, updated_at",
});

// Version 8 : détection de conflits de synchronisation. sync_queue garde
// le même schéma d'index (reference_write_date n'a pas besoin d'être
// indexé, Dexie le stocke tel quel comme propriété additionnelle).
// sync_conflicts met en cache localement les conflits reçus du serveur
// en attente d'arbitrage manuel, pour survivre à une coupure réseau
// entre leur réception et leur résolution par l'utilisateur.
db.version(8).stores({
  sync_queue: "++id, local_uuid, status, model_name, created_at",
  security_info: "model, updated_at",
  installed_apps: "technical_name",
  reference_records: "[model+id], model",
  module_manifests: "technical_name, updated_at",
  list_cache: "model, updated_at",
  record_cache: "[model+record_id], model",
  dashboard_cache: "key, updated_at",
  sync_conflicts: "local_uuid, status, model_name",
});

// Version 9 : cache du catalogue produits (bouton "Catalogue" sur les
// lignes one2many de commande, ex: sale.order.line / purchase.order.line).
// key = "<model>::<partner_id|none>" pour distinguer un catalogue Ventes
// (générique) d'un catalogue Achats filtré par fournisseur, chacun avec
// son propre prix (voir catalog_controller.py côté backend).
db.version(9).stores({
  sync_queue: "++id, local_uuid, status, model_name, created_at",
  security_info: "model, updated_at",
  installed_apps: "technical_name",
  reference_records: "[model+id], model",
  module_manifests: "technical_name, updated_at",
  list_cache: "model, updated_at",
  record_cache: "[model+record_id], model",
  dashboard_cache: "key, updated_at",
  sync_conflicts: "local_uuid, status, model_name",
  catalog_cache: "key, updated_at",
});

// Version 10 : métadonnée du propriétaire du cache local. Une PWA sur un
// même appareil peut être utilisée par plusieurs utilisateurs Odoo
// successifs (ex: poste partagé) — cette table permet de détecter un
// changement d'utilisateur au login et de purger tout le cache avant de
// charger les données du nouvel utilisateur, pour éviter qu'un compte
// hérite silencieusement des données mises en cache par un autre.
db.version(10).stores({
  sync_queue: "++id, local_uuid, status, model_name, created_at",
  security_info: "model, updated_at",
  installed_apps: "technical_name",
  reference_records: "[model+id], model",
  module_manifests: "technical_name, updated_at",
  list_cache: "model, updated_at",
  record_cache: "[model+record_id], model",
  dashboard_cache: "key, updated_at",
  sync_conflicts: "local_uuid, status, model_name",
  catalog_cache: "key, updated_at",
  cache_meta: "key",
});