#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=service_password="$POSTGRES_PASSWORD" <<'SQL'
ALTER ROLE altura_identity PASSWORD :'service_password';
ALTER ROLE altura_trails PASSWORD :'service_password';
ALTER ROLE altura_ledger PASSWORD :'service_password';
SQL
