#!/bin/sh
# Stage the real game sources plus a `three` shim in /tmp and run the
# headless bot smoke test there. Nothing is modified in the repo.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE=/tmp/breachline-smoke
rm -rf "$STAGE"
mkdir -p "$STAGE/node_modules/three"
cp "$ROOT/game/src/"*.js "$STAGE/"
cp "$ROOT/tools/smoke-test.mjs" "$STAGE/"
cp "$ROOT/game/vendor/three/three.module.min.js" "$STAGE/node_modules/three/"
cp "$ROOT/game/vendor/three/three.core.min.js" "$STAGE/node_modules/three/"
cat > "$STAGE/node_modules/three/package.json" <<'EOF'
{"type":"module","main":"three.module.min.js","exports":{".":"./three.module.min.js"}}
EOF
cd "$STAGE" && node smoke-test.mjs
