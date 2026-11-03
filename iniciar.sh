#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
command -v docker >/dev/null || { echo 'Se necesita Docker con Compose.'; exit 1; }
command -v node >/dev/null || { echo 'Se necesita Node.js 24.'; exit 1; }
node scripts/setup.mjs
docker compose up -d --build
node scripts/demo.mjs
echo 'Abre http://localhost:8088 para ver la demostración y la API.'
