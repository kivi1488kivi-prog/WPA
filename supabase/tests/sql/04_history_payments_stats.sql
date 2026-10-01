-- Historical snapshots, barber deactivation, payments (append-only), SQL stats
-- with period/timezone and barber/service filters, go-live of preview tenants.
begin;
\i supabase/tests/sql/_fixtures.sql

select private.local_ts(:'monday', 600, 'Europe/Berlin') as mon_1000,
       private.local_ts(:'monday', 660, 'Europe/Berlin') as mon_1100,
       private.local_ts(:'monday', 720, 'Europe/Berlin') as mon_1200,
       private.local_ts(current_date - 3, 600, 'Europe/Berlin') as past_1000,
       private.local_ts(current_date - 3, 720, 'Europe/Berlin') as past_1200,
       (current_date - 3) as past_day \gset

:as_anon
select public.create_booking('test-a', :'cut', :'anna', :'mon_1000', '{"name":"Ivan","phone":"+49 151 1111111"}', gen_random_uuid()) as r1 \gset
select (:'r1'::jsonb ->> 'booking_id') as b1, (:'r1'::jsonb ->> 'token') as t1 \gset

-- Historical price ------------------------------------------------------------------------
:as_owner_a
select public.owner_upsert_service(:'tenant_a', jsonb_build_object('id', :'cut', 'price_cents', 4500, 'name', 'Haircut Premium'));
:as_anon
select tests.eq((public.get_booking_by_token(:'t1') #>> '{service,price_cents}')::int, 3000, 'existing booking keeps historical price');
select tests.eq(public.get_booking_by_token(:'t1') #>> '{service,name}', 'Haircut', 'existing booking keeps historical service name');
select tests.eq((select (s ->> 'price_cents')::int from jsonb_array_elements(public.get_tenant_public('test-a') -> 'services') s
                 where s ->> 'id' = :'cut'), 4500, 'new price is public for new bookings');
select public.create_booking('test-a', :'cut', :'anna', :'mon_1100', '{"name":"Max","phone":"+49 151 3333333"}', gen_random_uuid()) as r2 \gset
select tests.eq((:'r2'::jsonb #>> '{booking,service,price_cents}')::int, 4500, 'new booking uses the new price');

-- Snapshot immutability -----------------------------------------------------------------------
:as_admin
select tests.throws(format($$update public.bookings set snap_price_cents = 1 where id = %L$$, :'b1'), 'immutable_snapshot',
                    'snapshot price cannot be changed even by the DB owner');
select tests.throws(format($$update public.bookings set snap_service_name = 'x' where id = %L$$, :'b1'), 'immutable_snapshot',
                    'snapshot service name immutable');
select tests.throws(format($$update public.bookings set snap_barber_name = 'x' where id = %L$$, :'b1'), 'immutable_snapshot',
                    'barber name snapshot only changes with reassignment');

-- Barber deactivation keeps history -----------------------------------------------------------
:as_owner_a
select public.owner_upsert_barber(:'tenant_a', jsonb_build_object('id', :'anna', 'is_active', false, 'name', 'Anna Renamed'));
:as_anon
select tests.ok(not exists (select 1 from jsonb_array_elements(public.get_tenant_public('test-a') -> 'barbers') b where b ->> 'id' = :'anna'),
                'inactive barber hidden from public page');
select tests.throws(format($$select public.get_available_slots('test-a', %L, %L, %L)$$, :'cut', :'anna', :'monday'),
                    'barber_not_eligible', 'inactive barber cannot be chosen');
select tests.throws(format($$select public.create_booking('test-a', %L, %L, %L, '{"name":"Z","phone":"+49 151 4444444"}', gen_random_uuid())$$,
                           :'cut', :'anna', :'mon_1200'), 'slot_unavailable', 'inactive barber gets no new bookings');
select tests.eq(public.get_booking_by_token(:'t1') #>> '{barber,name}', 'Anna', 'old booking still shows barber name at booking time');
:as_owner_a
select tests.ok(exists (select 1 from jsonb_array_elements(public.owner_calendar(:'tenant_a', :'monday', :'monday') -> 'barbers') b
                        where b ->> 'id' = :'anna'), 'calendar still shows inactive barber that has bookings');
:as_admin
select tests.throws(format($$delete from public.barbers where id = %L$$, :'anna'), '23503', 'barber with bookings cannot be hard-deleted');
select tests.throws(format($$delete from public.services where id = %L$$, :'cut'), '23503', 'service with bookings cannot be hard-deleted');

-- Payments & stats -------------------------------------------------------------------------------
-- Past visits (owner-created, outside lead rules) for stats.
:as_owner_a
select public.owner_upsert_barber(:'tenant_a', jsonb_build_object('id', :'anna', 'is_active', true));
select public.owner_create_booking(:'tenant_a', :'cut', :'boris', :'past_1000', '{"name":"Old","phone":"+49 151 5555555"}', '', true, gen_random_uuid()) as p1 \gset
select public.owner_create_booking(:'tenant_a', :'beard', :'anna', :'past_1200', '{"name":"Old2","phone":"+49 151 6666666"}', '', true, gen_random_uuid()) as p2 \gset
select (:'p1'::jsonb ->> 'booking_id') as pb1, (:'p2'::jsonb ->> 'booking_id') as pb2 \gset
select public.owner_set_booking_status(:'tenant_a', :'pb1', 'completed');
select public.owner_set_booking_status(:'tenant_a', :'pb2', 'no_show');
select tests.throws(format($$select public.owner_set_booking_status(%L, %L, 'completed')$$, :'tenant_a', :'b1'),
                    'invalid_transition', 'future booking cannot be marked completed');
select public.owner_record_payment(:'tenant_a', :'pb1', 4500, 'card', 'payment', 'tip incl.', 'cccccccc-0000-0000-0000-000000000001') as pay1 \gset
select tests.ok((public.owner_record_payment(:'tenant_a', :'pb1', 4500, 'card', 'payment', 'tip incl.', 'cccccccc-0000-0000-0000-000000000001') ->> 'replayed')::boolean,
                'payment retry with same key is idempotent');
select tests.throws(format($$select public.owner_record_payment(%L, %L, 9999, 'card', 'refund', '', gen_random_uuid())$$, :'tenant_a', :'pb1'),
                    'invalid_input', 'refund cannot exceed paid amount');
select public.owner_record_payment(:'tenant_a', :'pb1', 500, 'card', 'refund', 'partial', gen_random_uuid());
:as_admin
select tests.throws($$update public.payments set amount_cents = 1$$, 'immutable_payment', 'payments are append-only (update)');
select tests.throws($$delete from public.payments$$, 'immutable_payment', 'payments are append-only (delete)');

:as_owner_a
select public.owner_stats(:'tenant_a', :'past_day', :'monday') as st \gset
select tests.eq((:'st'::jsonb #>> '{totals,completed_count}')::int, 1, 'stats: 1 completed visit');
select tests.eq((:'st'::jsonb #>> '{totals,completed_value_cents}')::int, 4500, 'stats: completed value = price snapshot at booking time');
select tests.eq((:'st'::jsonb #>> '{totals,no_show_count}')::int, 1, 'stats: 1 no-show');
select tests.eq((:'st'::jsonb #>> '{totals,upcoming_count}')::int, 2, 'stats: 2 upcoming bookings');
select tests.eq((:'st'::jsonb #>> '{totals,upcoming_value_cents}')::int, 7500, 'stats: upcoming value (expected, not revenue)');
select tests.eq((:'st'::jsonb #>> '{totals,received_cents}')::int, 4000, 'stats: received = payments - refunds');
select tests.eq((:'st'::jsonb #>> '{totals,refunded_cents}')::int, 500, 'stats: refunds reported separately');
select tests.eq(:'st'::jsonb #>> '{period,timezone}', 'Europe/Berlin', 'stats: period stated in tenant timezone');
select tests.eq((public.owner_stats(:'tenant_a', :'past_day', :'monday', :'anna') #>> '{totals,received_cents}')::int, 0,
                'stats: barber filter (Anna has no payments)');
select tests.eq((public.owner_stats(:'tenant_a', :'past_day', :'monday', null, :'beard') #>> '{totals,no_show_count}')::int, 1,
                'stats: service filter');
select tests.eq((public.owner_stats(:'tenant_a', :'monday', :'monday') #>> '{totals,completed_count}')::int, 0,
                'stats: period filter excludes past visits');

-- Period boundaries follow local midnight: a booking at 00:30 local belongs to that local day.
:as_admin
select private.local_ts(:'monday'::date + 1, 30, 'Europe/Berlin') as tue_0030 \gset
insert into public.barber_weekly_hours (tenant_id, barber_id, weekday, start_min, end_min) values (:'tenant_a', :'boris', 2, 0, 120);
:as_owner_a
select public.owner_create_booking(:'tenant_a', :'cut', :'boris', :'tue_0030', '{"name":"Night","phone":"+49 151 7777777"}', '', false, gen_random_uuid());
select tests.eq((public.owner_stats(:'tenant_a', :'monday', :'monday') #>> '{totals,bookings_total}')::int, 2,
                'stats: 00:30 local Tuesday (22:30 UTC Monday) not counted on Monday');
select tests.eq((public.owner_stats(:'tenant_a', (:'monday'::date + 1), (:'monday'::date + 1)) #>> '{totals,bookings_total}')::int, 1,
                'stats: ...but counted on local Tuesday');

-- Customer card & history ------------------------------------------------------------------
select tests.eq(jsonb_array_length(public.owner_get_customer(:'tenant_a',
                  (select id from public.customers where phone_normalized = '+491515555555')) -> 'history'), 1,
                'customer card shows visit history');
select tests.ok(jsonb_array_length(public.owner_list_customers(:'tenant_a', 'Old')) >= 1, 'customer search by name');
select tests.eq(jsonb_array_length(public.owner_list_customers(:'tenant_a', '5555555')), 1, 'customer search by phone digits');

-- Preview -> live -----------------------------------------------------------------------------
:as_admin
update public.tenants set status = 'preview' where id = :'tenant_a';
:as_anon
select public.create_booking('test-a', :'beard', :'anna', :'mon_1200', '{"name":"Demo","phone":"+49 151 8888888"}', gen_random_uuid()) as rd \gset
select tests.ok((:'rd'::jsonb #>> '{booking,is_demo}')::boolean, 'bookings in preview are flagged demo');
:as_owner_a
select tests.ok((public.owner_go_live_check(:'tenant_a') ->> 'demo_bookings')::int >= 1, 'go-live check reports demo bookings');
select public.owner_go_live(:'tenant_a') as gl \gset
select tests.eq(:'gl'::jsonb ->> 'status', 'live', 'tenant goes live');
:as_admin
select tests.eq((select count(*)::int from public.bookings where tenant_id = :'tenant_a' and is_demo), 0, 'demo bookings purged on go-live');
select tests.ok((select count(*) from public.bookings where tenant_id = :'tenant_a') >= 4, 'real bookings kept on go-live');
update public.tenants set phone = null, status = 'preview' where id = :'tenant_b';
:as_owner_b
select tests.throws(format($$select public.owner_go_live(%L)$$, :'tenant_b'), 'not_ready', 'go-live refused when business settings incomplete');

rollback;
