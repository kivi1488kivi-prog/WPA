#!/usr/bin/env bash
# Recreate the local test database: Supabase shim + all migrations (+ optional seed).
# Usage: scripts/db/reset-local.sh [--seed]
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="${LOCAL_DB_NAME:-barbershop_test}"
PSQL_ADMIN="${PSQL_ADMIN:-psql -h localhost -U postgres -v ON_ERROR_STOP=1 -q -X}"
export PGOPTIONS="-c client_min_messages=warning"
export PGPASSWORD="${PGPASSWORD:-postgres}"
$PSQL_ADMIN -d postgres -c "drop database if exists $DB with (force)" >/dev/null
$PSQL_ADMIN -d postgres -c "create database $DB" >/dev/null
$PSQL_ADMIN -d "$DB" -f supabase/tests/shim/supabase_shim.sql >/dev/null
for f in supabase/migrations/*.sql; do
  $PSQL_ADMIN -d "$DB" -f "$f" >/dev/null || { echo "migration failed: $f" >&2; exit 1; }
done
if [[ "${1:-}" == "--seed" ]]; then
  $PSQL_ADMIN -d "$DB" -f supabase/seed.sql >/dev/null
fi
echo "local db '$DB' ready ($(ls supabase/migrations/*.sql | wc -l) migrations)"
