# Architecture OWL — mise en place (pas encore de vue migrée)

## Périmètre de cette étape

Uniquement la **plomberie** : vendoring d'OWL, bundling des templates,
bootstrap de mount/destroy, et un composant de test bout-en-bout
(`DebugPing`). **Aucune vue existante (form/list/kanban/fields) n'est
touchée** — le moteur vanilla actuel (`views/`, `core/`) continue de
tourner exactement comme avant.

## Décisions et pourquoi

### 1. OWL vendorisé en global, pas en dépendance npm

`static/lib/owl.iife.js` est chargé via `<script>` dans `index.html`,
avant `app.bundle.js`, exactement comme `dexie.min.js` et `popper.js`.
Le code applicatif référence le global `owl` directement (`owl.mount`,
`owl.Component`, `owl.useState`...), sans `import ... from "owl"` —
cohérent avec l'existant (`new Dexie(...)`, `window.Popper.createPopper(...)`),
et nécessaire de toute façon : le bundler ici est `esbuild --bundle`
sans `node_modules` embarqué en prod, pas un résolveur de paquets npm
complet.

Build vendorisé : hash `52abf8d`, daté 2026-01-30 (`owl.__info__` dans
le fichier). Build **complet et standard** : 37 exports vérifiés
(`Component`, `App`, `mount`, tous les hooks `use*`/`on*`, `xml`,
`reactive`, `EventBus`, etc. — voir la liste exhaustive en bas de ce
fichier). `owl/app.js` instancie directement `new owl.App(...)` pour
un accès explicite à `.destroy()` au cleanup.

Seul absent notable : `css` (l'helper de template littéral pour du
CSS scopé par composant, présent dans certaines versions d'OWL) —
la fonction n'existe pas du tout dans ce build, pas juste
non-exportée. Non bloquant : le scoping CSS peut se faire par classes
préfixées par composant, comme le fait déjà le moteur vanilla actuel.

### 2. Templates : fichiers `.xml` colocalisés, importés comme texte

Chaque composant a son `.xml` à côté de son `.js`
(`debug_ping.js` / `debug_ping.xml`), importé via
`import templateXml from "./x.xml"`, résolu par le loader esbuild
`--loader:.xml=text` (ajouté dans `scripts/build-bundle.sh`).

Alternative écartée : `fetch()` runtime des templates au démarrage
(approche d'Odoo en ligne). Rejetée parce que l'app doit fonctionner
100% hors-ligne dès le premier chargement, sans dépendre du cache HTTP
pour des fichiers annexes — un seul bundle, cohérent avec le choix
déjà fait pour tout le reste du moteur.

### 3. Coexistence avec le moteur vanilla

Rien n'est branché à `core/registry.js` ni à `views/view.js`. Le
composant `DebugPing` n'est monté que manuellement, depuis la console :

```js
window.__owl_debug__.mountSmokeTest()   // affiche un compteur en bas à droite
window.__owl_debug__.unmountSmokeTest() // le retire, détruit l'App
```

Câblé dans `main.js` (import + exposition sur `window`), mais jamais
appelé automatiquement au boot.

## Fichiers créés

```
static/lib/owl.iife.js              # vendorisé (build réel fourni par l'utilisateur)
static/src/owl/
  app.js                            # mountOwlApp() : owl.mount() + accès destroy
  templates.js                      # buildTemplateMap() : liste [name, xml] -> objet
  debug.js                          # mount/unmount du smoke test, exposé sur window
  components/debug_ping/
    debug_ping.js                   # Component OWL (state, event, props.onClose)
    debug_ping.xml                  # template : compteur + bouton +1 + bouton Fermer
```

## Exports vérifiés (37 au total)

App, Component, EventBus, OwlError, __info__, batched, blockDom,
htmlEscape, loadFile, markRaw, markup, mount, onError, onMounted,
onPatched, onRendered, onWillDestroy, onWillPatch, onWillRender,
onWillStart, onWillUnmount, onWillUpdateProps, reactive, status,
toRaw, useChildSubEnv, useComponent, useEffect, useEnv,
useExternalListener, useRef, useState, useSubEnv, validate,
validateType, whenReady, xml.

## Vérifié dans ce sandbox / à vérifier en navigateur

- ✅ Syntaxe ESM de tous les fichiers (`node --check`)
- ✅ `owl.iife.js` est bien un build réel et complet d'OWL (37 exports
  confirmés par inspection directe du fichier)
- ⚠️ **Pas d'exécution réelle testée ici** : ce sandbox n'a pas accès
  réseau pour installer `esbuild` (`npm install` échoue, 403) ni jsdom
  pour simuler un DOM en Node. Le bundling (`bash scripts/build-bundle.sh`)
  et le smoke test (`window.__owl_debug__.mountSmokeTest()`) sont à
  valider dans un vrai navigateur, après `cd scripts && npm install`
  en local.

## Prochaine étape (hors périmètre ici)

Une fois cette base validée en navigateur : choisir UN composant pilote
réel à migrer (proposition : un champ simple comme `char_field.js`,
le plus petit périmètre testable) avant d'attaquer form/list/kanban.
