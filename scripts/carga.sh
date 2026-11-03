#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p evidence
trap 'docker compose up -d --no-deps gateway >/dev/null 2>&1' EXIT
API_RATE_LIMIT=1000000 docker compose up -d --no-deps gateway
node -e 'async function ready(){for(let i=0;i<60;i++){try{let r=await fetch("http://localhost:8088/api/routes?limit=20");if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,500));}process.exit(1)}ready()'
docker run --rm --network altura-paz_backend --user "$(id -u):$(id -g)" \
  -v "$PWD/test/load.js:/load.js:ro" -v "$PWD/evidence:/evidence" \
  -e RATE=1000 -e DURATION=15s grafana/k6 \
  run --summary-export=/evidence/k6-reproduccion.json /load.js
