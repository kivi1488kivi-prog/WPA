#!/usr/bin/env bash
# Run SQL test-suite against a fresh local database.
# Requires a local PostgreSQL 15+ (contrib: btree_gist, pgcrypto). No Docker needed.
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="${LOCAL_DB_NAME:-barbershop_test}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
PSQL="psql -h localhost -U postgres -d $DB -v ON_ERROR_STOP=1 -q -X -t -A"
scripts/db/reset-local.sh >/dev/null
$PSQL -f supabase/tests/sql/_helpers.sql >/dev/null
pass=0; fail=0; failed_files=()
pattern="${1:-}"
for f in supabase/tests/sql/[0-9]*.sql; do
  [[ -n "$pattern" && "$f" != *"$pattern"* ]] && continue
  out=$($PSQL -f "$f" 2>&1) && status=0 || status=$?
  oks=$(grep -c "ok - " <<<"$out" || true)
  if [[ $status -ne 0 ]]; then
    fail=$((fail+1)); failed_files+=("$f")
    echo "✗ $f ($oks assertions passed before failure)"
    grep -E "ERROR|FAIL" <<<"$out" | head -5 | sed 's/^/    /'
  else
    pass=$((pass+oks))
    echo "✓ $f ($oks assertions)"
  fi
done
if [[ -z "$pattern" || "$pattern" == "concurrency" ]]; then
  if supabase/tests/concurrency.sh; then echo "✓ concurrency suite"; else fail=$((fail+1)); failed_files+=(concurrency); fi
fi
echo "SQL tests: $pass assertions passed, $fail file(s) failed"
[[ $fail -eq 0 ]]
