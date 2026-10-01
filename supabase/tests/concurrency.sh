#!/usr/bin/env bash
# Real concurrency tests: separate PostgreSQL sessions released simultaneously
# through an advisory-lock gate. Verifies the EXCLUDE constraint + transactions.
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="${LOCAL_DB_NAME:-barbershop_test}_conc"
export PGPASSWORD="${PGPASSWORD:-postgres}"
LOCAL_DB_NAME="$DB" scripts/db/reset-local.sh >/dev/null
P="psql -h localhost -U postgres -d $DB -v ON_ERROR_STOP=1 -q -X -t -A"
$P -f supabase/tests/sql/_helpers.sql >/dev/null
$P -f supabase/tests/sql/_fixtures.sql >/dev/null 2>&1

q() { $P -c "$1" 2>&1 | tail -1; }
TA=$(q "select id from public.tenants where slug='test-a'")
CUT=$(q "select id from public.services where pipeline_key='cut' and tenant_id='$TA'")
ANNA=$(q "select id from public.barbers where pipeline_key='anna'")
BORIS=$(q "select id from public.barbers where pipeline_key='boris'")
MON=$(q "select tests.next_monday()")
ts() { q "select private.local_ts('$1'::date + $2, $3, 'Europe/Berlin')"; }
fails=0
check() { if [[ "$2" == "$3" ]]; then echo "  ok - $1"; else echo "  FAIL - $1 (expected $3, got $2)"; fails=$((fails+1)); fi; }

TMP=$(mktemp -d)
# Gate: a holder session keeps an exclusive advisory lock; contenders wait on it.
gate_hold() { $P -c "select pg_advisory_lock(777); select pg_sleep($1);" >/dev/null & echo $!; }
contender() { # $1 = id, $2 = sql
  $P -c "select pg_advisory_lock_shared(777); select pg_advisory_unlock_shared(777);
         select set_config('request.headers', '{\"x-forwarded-for\":\"10.0.0.$1\"}', false);
         set role anon; $2" >"$TMP/$1.out" 2>&1 || true
}
run_race() { # $1 = count, $2 = sql template with __I__
  local holder; holder=$(gate_hold 1.5); sleep 0.3
  for i in $(seq 1 "$1"); do contender "$i" "${2//__I__/$i}" & done
  wait
}

echo "concurrency: same barber, same slot (8 sessions)"
T1=$(ts "$MON" 0 600)
run_race 8 "select public.create_booking('test-a', '$CUT', '$ANNA', '$T1', '{\"name\":\"C__I__\",\"phone\":\"+49 151 70000__I__\"}', gen_random_uuid());"
ok=$(grep -l '"booking_id"' "$TMP"/*.out | wc -l); bad=$(grep -l 'slot_unavailable' "$TMP"/*.out | wc -l)
check "exactly one session wins" "$ok" "1"
check "seven sessions get slot_unavailable" "$bad" "7"
check "one active occupancy at that time" "$(q "select count(*) from public.resource_occupancies where barber_id='$ANNA' and active and during && tstzrange('$T1', '$T1'::timestamptz + interval '1 minute')")" "1"
rm -f "$TMP"/*.out

echo "concurrency: different barbers, same time (parallel)"
T2=$(ts "$MON" 0 660)
run_race 2 "select public.create_booking('test-a', '$CUT', (case when __I__ = 1 then '$ANNA' else '$BORIS' end)::uuid, '$T2', '{\"name\":\"D__I__\",\"phone\":\"+49 151 71000__I__\"}', gen_random_uuid());"
check "both bookings succeed" "$(grep -l '"booking_id"' "$TMP"/*.out | wc -l)" "2"
rm -f "$TMP"/*.out

echo "concurrency: 'any barber' race (4 sessions, 2 eligible barbers)"
T3=$(ts "$MON" 0 720)
run_race 4 "select public.create_booking('test-a', '$CUT', null, '$T3', '{\"name\":\"E__I__\",\"phone\":\"+49 151 72000__I__\"}', gen_random_uuid());"
check "two sessions win" "$(grep -l '"booking_id"' "$TMP"/*.out | wc -l)" "2"
check "two sessions refused" "$(grep -l 'slot_unavailable' "$TMP"/*.out | wc -l)" "2"
check "the winners got different barbers" "$(q "select count(distinct barber_id) from public.bookings where starts_at = '$T3'")" "2"
rm -f "$TMP"/*.out

echo "concurrency: same idempotency key (5 sessions)"
T4=$(ts "$MON" 0 900)
run_race 5 "select public.create_booking('test-a', '$CUT', '$BORIS', '$T4', '{\"name\":\"Same\",\"phone\":\"+49 151 7300000\"}', 'eeeeeeee-0000-0000-0000-000000000001') ->> 'booking_id';"
check "one booking row for the key" "$(q "select count(*) from public.bookings where idempotency_key = 'eeeeeeee-0000-0000-0000-000000000001'")" "1"
check "all 5 responses carry the same booking id" "$(cat "$TMP"/*.out | grep -E '^[0-9a-f-]{36}$' | sort -u | wc -l)" "1"
check "all 5 sessions succeeded" "$(cat "$TMP"/*.out | grep -cE '^[0-9a-f-]{36}$')" "5"
rm -f "$TMP"/*.out

echo "concurrency: reschedule vs new booking for the same target slot"
T5=$(ts "$MON" 0 840); T6=$(ts "$MON" 0 960)
TOK=$($P -c "set role anon; select public.create_booking('test-a', '$CUT', '$ANNA', '$T5', '{\"name\":\"Mover\",\"phone\":\"+49 151 7400000\"}', gen_random_uuid()) ->> 'token';" | tail -1)
BK=$(q "select id from public.bookings where starts_at = '$T5' and barber_id = '$ANNA'")
run_race 2 "select case when __I__ = 1
   then public.reschedule_booking_by_token('$TOK', '$T6', null, false, gen_random_uuid()) ->> 'id'
   else public.create_booking('test-a', '$CUT', '$ANNA', '$T6', '{\"name\":\"Racer\",\"phone\":\"+49 151 7500000\"}', gen_random_uuid()) ->> 'booking_id' end;"
check "exactly one of reschedule/create wins" "$(grep -cE '^[0-9a-f-]{36}$' "$TMP"/1.out "$TMP"/2.out | awk -F: '{s+=$2} END {print s}')" "1"
check "moved booking keeps exactly one active occupancy" "$(q "select count(*) from public.resource_occupancies where booking_id = '$BK' and active")" "1"
check "one active occupancy at the contested time" "$(q "select count(*) from public.resource_occupancies where barber_id='$ANNA' and active and during && tstzrange('$T6', '$T6'::timestamptz + interval '1 minute')")" "1"
rm -f "$TMP"/*.out

echo "concurrency: shop-wide block vs booking"
T7=$(ts "$MON" 1 600); T8=$(ts "$MON" 1 660)
OWNER_CLAIMS='{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1"}'
holder=$(gate_hold 1.5); sleep 0.3
$P -c "select pg_advisory_lock_shared(777); select pg_advisory_unlock_shared(777);
       select set_config('request.jwt.claims', '$OWNER_CLAIMS', false); set role authenticated;
       select public.owner_create_block('$TA', null, '$T7', '$T8', 'event', 'race');" >"$TMP/blk.out" 2>&1 &
contender 9 "select public.create_booking('test-a', '$CUT', '$BORIS', '$T7', '{\"name\":\"F\",\"phone\":\"+49 151 7600000\"}', gen_random_uuid());" &
wait
blk_ok=$(grep -c 'block_id' "$TMP/blk.out" || true); bk_ok=$(grep -c 'booking_id' "$TMP/9.out" || true)
check "block and booking never both succeed" "$((blk_ok + bk_ok))" "1"
check "no booking overlaps an active block" "$(q "select count(*) from public.resource_occupancies a join public.resource_occupancies b
   on a.barber_id = b.barber_id and a.id < b.id and a.active and b.active and a.during && b.during")" "0"

rm -rf "$TMP"
echo "concurrency: $fails failure(s)"
[[ $fails -eq 0 ]]
