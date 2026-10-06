# Offline Webclient 17

Addon Odoo 17 expérimental, distinct de la PWA racine. Il s’intègre au WebClient natif via `web.assets_backend` et conserve les vues, le SearchModel et le RelationalModel d’Odoo.

## Premier jalon livré

- Mise en cache IndexedDB des réponses réussies d’un ensemble restreint d’appels ORM de lecture.
- Repli sur la dernière réponse pour **la même requête** lorsque le navigateur ou le serveur est hors ligne.
- Indicateur « Hors ligne — lectures en cache » dans la barre supérieure.
- Invalidation du cache de lecture après les mutations ORM natives réussies reconnues par l’addon.
- Isolation des clés de cache par base, utilisateur, contexte, modèle, méthode et arguments.

Ce jalon ne fournit pas encore une expérience complète comme celle annoncée pour Odoo 20. Il ne met pas les écritures en file et ne fabrique pas d’identifiants locaux. Il ne permet donc pas encore de créer, modifier ou supprimer des enregistrements hors ligne, ni de rejouer une recherche différente de celle qui a été exécutée en ligne. Un repli de lecture n’est possible que si la requête exacte a déjà réussi en ligne dans ce navigateur.

## Prochaines étapes proposées

1. Téléchargement initial des menus, vues, métadonnées, droits et enregistrements nécessaires.
2. Moteur local de recherche sur les données synchronisées, au-delà du cache exact de RPC.
3. File durable des créations/modifications/suppressions, identifiants temporaires et résolution des références.
4. Reconnexion, synchronisation, conflits et erreurs métier visibles par l’utilisateur.
5. Tests d’intégration sur une instance Odoo 17 réelle, puis essais hors ligne/rechargement navigateur.

Les méthodes Python arbitraires, `onchange`, valeurs calculées et contraintes serveur ne peuvent pas être reproduites automatiquement hors ligne. Le cache IndexedDB n’est pas chiffré et n’a pas d’expiration automatique : une réponse peut devenir obsolète si les données changent dans une autre session, et les données restent sur cet appareil jusqu’à invalidation, éviction ou effacement du stockage du navigateur. Aucune commande de purge utilisateur n’est fournie ; ne l’activez que sur des appareils de confiance.

## Installation locale

Placez le dossier `offline_webclient_17` dans un chemin `addons_path` d’Odoo 17, mettez à jour la liste des applications puis installez **Offline Webclient 17**. Ce module ne dépend pas de la PWA ni du module `offline_sync`.
