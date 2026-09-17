set -euo pipefail

cd "$(dirname "$0")/.."

ENTRY="static/src/main.js"
OUTPUT="static/src/bundles/app.bundle.js"
ESBUILD="scripts/node_modules/.bin/esbuild"

mkdir -p static/src/bundles

if [ ! -x "$ESBUILD" ]; then
  echo "ERREUR : esbuild introuvable ($ESBUILD)."
  echo "Lancez d'abord : (cd scripts && npm install)"
  exit 1
fi

echo "esbuild détecté : $("$ESBUILD" --version)"

if [ ! -f "$ENTRY" ]; then
  echo "Info : $ENTRY n'existe pas encore (arrive en Phase 1 de la migration ESM)."
  echo "Rien à bundler pour l'instant — outillage esbuild opérationnel, c'est tout ce que la Phase 0 vérifie."
  exit 0
fi

"$ESBUILD" "$ENTRY" \
  --bundle \
  --loader:.xml=text \
  --outfile="$OUTPUT" \
  --format=iife \
  --target=es2020 \
  --sourcemap \
  --log-level=info

echo "Bundle généré : $OUTPUT ($(wc -l < "$OUTPUT") lignes)"
