-- Token access, idempotency, reschedule (incl. failed reschedule keeping the
-- original), cancel, tenant & per-service policies.
begin;
\i supabase/tests/sql/_fixtures.sql

select private.local_ts(:'monday', 600, 'Europe/Berlin') as mon_1000,
       private.local_ts(:'monday', 840, 'Europe/Berlin') as mon_1400,
       private.local_ts(:'monday', 900, 'Europe/Berlin') as mon_1500,
       private.local_ts(:'monday', 915, 'Europe/Berlin') as mon_1515,
       private.local_ts(:'monday', 780, 'Europe/Berlin') as mon_1300,
       private.local_ts(:'monday', 960, 'Europe/Berlin') as mon_1600,
       private.local_ts(:'monday', 1020, 'Europe/Berlin') as mon_1700,
       private.local_ts(:'monday', 540, 'America/New_York') as b_mon_0900,
       private.local_ts(:'monday', 600, 'America/New_York') as b_mon_1000,
       date_trunc('hour', now()) + interval '2 hours' as soon \gset

:as_anon
select public.create_booking('test-a', :'cut', :'anna', :'mon_1000',
       '{"name":"Ivan","phone":"+49 151 1111111"}', '11111111-0000-0000-0000-000000000001') as r1 \gset
select (:'r1'::jsonb ->> 'token') as t1, (:'r1'::jsonb ->> 'booking_id') as b1 \gset

-- Idempotency of create ------------------------------------------------------------
select public.create_booking('test-a', :'cut', :'anna', :'mon_1000',
       '{"name":"Ivan","phone":"+49 151 1111111"}', '11111111-0000-0000-0000-000000000001') as r1b \gset
select tests.eq(:'r1b'::jsonb ->> 'booking_id', :'b1', 'retry with same key returns the same booking');
select tests.eq(:'r1b'::jsonb ->> 'token', :'t1', 'retry with same key returns the same access token');
select tests.ok((:'r1b'::jsonb ->> 'replayed')::boolean, 'retry is flagged as replayed');
select tests.throws(format($$select public.create_booking('test-a', %L, %L, %L, '{"name":"Ivan","phone":"+49 151 1111111"}', '11111111-0000-0000-0000-000000000001')$$,
                           :'cut', :'anna', :'mon_1400'),
                    'idempotency_mismatch', 'same key with different payload is rejected');

:as_admin
select tests.eq((select count(*)::int from public.bookings where idempotency_key = '11111111-0000-0000-0000-000000000001'), 1,
                'only one booking row exists for the key');
select tests.ok((select token_hash = extensions.digest(:'t1', 'sha256') from public.bookings where id = :'b1'),
                'only SHA-256 of the token is stored');
select tests.ok(not exists (select 1 from public.bookings b where to_jsonb(b)::text like '%' || :'t1' || '%'),
                'plaintext token is not stored anywhere in the booking row');

-- Token access ----------------------------------------------------------------------
:as_anon
select tests.eq(public.get_booking_by_token(:'t1') ->> 'id', :'b1', 'token opens its booking');
select tests.throws($$select public.get_booking_by_token('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')$$,
                    'booking_not_found', 'random token opens nothing');
select tests.ok((public.get_booking_by_token(:'t1') #>> '{customer,phone_masked}') like '%11',
                'phone is masked in token view');

-- Reschedule ------------------------------------------------------------------------
select public.reschedule_booking_by_token(:'t1', :'mon_1400', null, false, '22222222-0000-0000-0000-000000000001') as rs1 \gset
select tests.eq(:'rs1'::jsonb ->> 'local_time', '14:00', 'reschedule moved booking to 14:00');
select tests.eq((:'rs1'::jsonb ->> 'version')::int, 2, 'version incremented');
select tests.ok(exists (select 1 from jsonb_array_elements(
                  public.get_available_slots('test-a', :'cut', :'anna', :'monday') -> 'slots') s
                  where s ->> 'local_time' = '10:00'), 'old 10:00 slot released');
select public.reschedule_booking_by_token(:'t1', :'mon_1400', null, false, '22222222-0000-0000-0000-000000000001') as rs1b \gset
select tests.eq((:'rs1b'::jsonb ->> 'version')::int, 2, 'reschedule retry with same key is a no-op');
select tests.throws(format($$select public.reschedule_booking_by_token(%L, %L, null, false, '22222222-0000-0000-0000-000000000001')$$,
                           :'t1', :'mon_1500'),
                    'idempotency_mismatch', 'reschedule key reuse with other payload rejected');

-- Failed reschedule keeps the original -------------------------------------------------
select public.create_booking('test-a', :'cut', :'anna', :'mon_1500',
       '{"name":"Olga","phone":"+49 151 7777777"}', '11111111-0000-0000-0000-000000000002') as r2 \gset
select tests.throws(format($$select public.reschedule_booking_by_token(%L, %L, null, false, gen_random_uuid())$$,
                           :'t1', :'mon_1515'),
                    'slot_unavailable', 'reschedule into an occupied range fails');
select tests.throws(format($$select public.reschedule_booking_by_token(%L, %L, null, false, gen_random_uuid())$$,
                           :'t1', :'mon_1300'),
                    'slot_unavailable', 'reschedule into the lunch gap fails');
select tests.eq(public.get_booking_by_token(:'t1') ->> 'local_time', '14:00', 'original booking time preserved after failures');
select tests.eq((public.get_booking_by_token(:'t1') ->> 'version')::int, 2, 'version unchanged after failures');
:as_admin
select tests.eq((select count(*)::int from public.resource_occupancies where booking_id = :'b1' and active), 1,
                'exactly one active occupancy remains for the booking');
select tests.ok((select during = tstzrange(:'mon_1400'::timestamptz, :'mon_1400'::timestamptz + interval '40 minutes')
                 from public.resource_occupancies where booking_id = :'b1' and active),
                'active occupancy still covers the original 14:00 range');

-- Reschedule with "any barber": Anna busy at 15:00 -> Boris
:as_anon
select public.reschedule_booking_by_token(:'t1', :'mon_1500', null, true, gen_random_uuid()) as rs2 \gset
select tests.eq(:'rs2'::jsonb #>> '{barber,name}', 'Boris', 'reschedule to any barber picks a free eligible one');
:as_admin
select tests.ok((select snap_barber_name = 'Boris' and snap_price_cents = 3000 from public.bookings where id = :'b1'),
                'barber snapshot follows assignment, price snapshot kept');

-- Self-reschedule limit (max 2)
:as_anon
select tests.throws(format($$select public.reschedule_booking_by_token(%L, %L, null, true, gen_random_uuid())$$,
                           :'t1', :'mon_1600'),
                    'policy_violation', 'third self-reschedule refused (max_self_reschedules = 2)');

-- Cancel ----------------------------------------------------------------------------------
select tests.eq(public.cancel_booking_by_token(:'t1', 'changed plans') ->> 'status', 'cancelled', 'client cancels by token');
select tests.eq(public.cancel_booking_by_token(:'t1') ->> 'status', 'cancelled', 'cancel retry is idempotent');
select tests.throws(format($$select public.reschedule_booking_by_token(%L, %L, null, true, gen_random_uuid())$$, :'t1', :'mon_1700'),
                    'policy_violation', 'cancelled booking cannot be rescheduled');
select tests.ok(exists (select 1 from jsonb_array_elements(
                  public.get_available_slots('test-a', :'cut', :'boris', :'monday') -> 'slots') s
                  where s ->> 'local_time' = '15:00'), 'cancellation releases the slot');
:as_admin
select tests.eq((select count(*)::int from public.booking_events where booking_id = :'b1'), 4,
                'history: created, 2x rescheduled, cancelled');

-- Per-service policy: color cannot be self-cancelled ----------------------------------------
:as_anon
select public.create_booking('test-a', :'color', :'boris', :'mon_1000',
       '{"name":"Vera","phone":"+49 151 8888888"}', gen_random_uuid()) as r3 \gset
select tests.throws(format($$select public.cancel_booking_by_token(%L)$$, :'r3'::jsonb ->> 'token'),
                    'policy_violation', 'service-level override forbids self cancel');
select tests.eq((:'r3'::jsonb #>> '{booking,actions,cancel_block_reason}'), 'self_cancel_disabled', 'reason exposed to UI');

-- Minimum notice: booking too close to start -----------------------------------------------
:as_owner_a
select public.owner_create_booking(:'tenant_a', :'cut', :'boris', :'soon',
       '{"name":"Soon","phone":"+49 151 9999999"}', '', true, '33333333-0000-0000-0000-000000000001') as r4 \gset
select public.owner_booking_access_token(:'tenant_a', (:'r4'::jsonb ->> 'booking_id')::uuid) as t4 \gset
:as_anon
select tests.throws(format($$select public.cancel_booking_by_token(%L)$$, :'t4'),
                    'policy_violation', 'cancel inside minimum notice refused');
select tests.eq(public.get_booking_by_token(:'t4') #>> '{actions,cancel_block_reason}', 'too_late', 'too_late reason');

-- Tenant policy: B forbids self reschedule ---------------------------------------------------
select public.create_booking('test-b', :'cut_b', :'dave', :'b_mon_0900',
       '{"name":"Bob","phone":"+1 212 5550199"}', gen_random_uuid()) as rb \gset
select tests.throws(format($$select public.reschedule_booking_by_token(%L, %L, null, false, gen_random_uuid())$$,
                           :'rb'::jsonb ->> 'token', :'b_mon_1000'),
                    'policy_violation', 'tenant B disallows self reschedule');

-- Staff can still reschedule & cancel ---------------------------------------------------------
:as_owner_a
select public.owner_reschedule_booking(:'tenant_a', (:'r4'::jsonb ->> 'booking_id')::uuid, :'mon_1700', null, false, gen_random_uuid());
select public.owner_cancel_booking(:'tenant_a', (:'r3'::jsonb ->> 'booking_id')::uuid, 'staff decision');
:as_anon
select tests.eq(public.get_booking_by_token(:'t4') ->> 'local_time', '17:00', 'owner reschedule ignores client notice policy');
select tests.eq(public.get_booking_by_token(:'r3'::jsonb ->> 'token') ->> 'status', 'cancelled', 'owner cancelled color booking');

-- Validation -------------------------------------------------------------------------------
select tests.throws(format($$select public.create_booking('test-a', %L, null, %L, '{"name":"","phone":"+49 151 1"}', gen_random_uuid())$$,
                           :'cut', :'mon_1600'), 'invalid_name', 'empty name rejected');
select tests.throws(format($$select public.create_booking('test-a', %L, null, %L, '{"name":"N","phone":"12"}', gen_random_uuid())$$,
                           :'cut', :'mon_1600'), 'invalid_phone', 'bad phone rejected');
select tests.throws(format($$select public.create_booking('test-a', %L, null, %L, '{"name":"N","phone":"+49 151 1234567","email":"nope"}', gen_random_uuid())$$,
                           :'cut', :'mon_1600'), 'invalid_email', 'bad email rejected');
select tests.throws(format($$select public.create_booking('test-a', %L, null, now() + interval '10 minutes', '{"name":"N","phone":"+49 151 1234567"}', gen_random_uuid())$$,
                           :'cut'), 'slot_unavailable', 'minimum lead time enforced');
select tests.throws(format($$select public.create_booking('test-a', %L, null, %L, '{"name":"N","phone":"+49 151 1234567"}', gen_random_uuid())$$,
                           :'cut_b', :'mon_1600'), 'service_not_found', 'service of another tenant is not bookable via this slug');

rollback;
