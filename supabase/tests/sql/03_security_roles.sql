-- RLS, GRANTs, tenant isolation, roles owner/admin/barber, storage policies.
begin;
\i supabase/tests/sql/_fixtures.sql

select private.local_ts(:'monday', 600, 'Europe/Berlin') as mon_1000,
       private.local_ts(:'monday', 720, 'Europe/Berlin') as mon_1200,
       private.local_ts(:'monday', 540, 'America/New_York') as b_mon_0900 \gset

:as_anon
select public.create_booking('test-a', :'cut', :'anna', :'mon_1000', '{"name":"Ivan","phone":"+49 151 1111111"}', gen_random_uuid()) as ra \gset
select public.create_booking('test-a', :'cut', :'boris', :'mon_1000', '{"name":"Petr","phone":"+49 151 2222222"}', gen_random_uuid()) as rb \gset
select public.create_booking('test-b', :'cut_b', :'dave', :'b_mon_0900', '{"name":"Bob","phone":"+1 212 5550199"}', gen_random_uuid()) as rc \gset
select (:'ra'::jsonb ->> 'booking_id') as bk_anna, (:'rb'::jsonb ->> 'booking_id') as bk_boris, (:'rc'::jsonb ->> 'booking_id') as bk_b \gset

-- anon: zero table access ------------------------------------------------------------
select tests.throws('select * from public.bookings', '42501', 'anon cannot read bookings');
select tests.throws('select * from public.customers', '42501', 'anon cannot read customers');
select tests.throws('select * from public.tenants', '42501', 'anon cannot read tenants table directly');
select tests.throws('select * from public.payments', '42501', 'anon cannot read payments');
select tests.throws('select * from public.push_subscriptions', '42501', 'anon cannot read push subscriptions');
select tests.throws('select * from public.notification_jobs', '42501', 'anon cannot read outbox');
select tests.throws('select * from private.app_secrets', '42501', 'anon cannot read secrets');
select tests.throws($$insert into public.bookings (tenant_id) values (gen_random_uuid())$$, '42501', 'anon cannot insert bookings');
select tests.throws($$select public.owner_my_tenants()$$, '42501', 'anon cannot call owner RPCs');
select tests.throws($$select public.worker_claim_notifications('x')$$, '42501', 'anon cannot call worker RPCs');
select tests.throws($$select public.ai_reserve(gen_random_uuid(), 1, 1, 1)$$, '42501', 'anon cannot reserve AI budget');
select tests.throws($$select public.pipeline_publish_tenant('{}')$$, '42501', 'anon cannot publish tenants');
select tests.throws($$select private.booking_token(gen_random_uuid(), gen_random_uuid())$$, '42501', 'anon cannot mint tokens');
select tests.ok((public.get_tenant_public('test-a')::text not like '%Ivan%'), 'public payload contains no customer data');
select tests.ok((public.get_available_slots('test-a', :'cut', null, :'monday')::text not like '%Ivan%'), 'slots contain no customer data');

-- authenticated without membership ----------------------------------------------------
reset role;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000dead"}', true);
set local role authenticated;
select tests.eq((select count(*)::int from public.bookings), 0, 'non-member sees no bookings via RLS');
select tests.eq((select count(*)::int from public.tenants), 0, 'non-member sees no tenants via RLS');
select tests.eq(public.owner_my_tenants(), '[]'::jsonb, 'non-member has no tenants');
select tests.throws(format($$select public.owner_calendar(%L, %L, %L)$$, :'tenant_a', :'monday', :'monday'), 'forbidden', 'non-member calendar forbidden');

-- tenant isolation: owner B vs tenant A --------------------------------------------------
:as_owner_b
select tests.eq((select count(*)::int from public.bookings), 1, 'owner B sees only tenant B bookings (RLS)');
select tests.eq((select count(*)::int from public.bookings where tenant_id = :'tenant_a'), 0, 'owner B cannot select tenant A rows');
select tests.eq((select count(*)::int from public.customers where tenant_id = :'tenant_a'), 0, 'owner B cannot see tenant A customers');
select tests.throws(format($$select public.owner_workspace(%L)$$, :'tenant_a'), 'forbidden', 'owner B cannot open tenant A workspace');
select tests.throws(format($$select public.owner_cancel_booking(%L, %L)$$, :'tenant_a', :'bk_anna'), 'forbidden', 'owner B cannot cancel tenant A booking');
select tests.throws(format($$select public.owner_cancel_booking(%L, %L)$$, :'tenant_b', :'bk_anna'), 'booking_not_found', 'tenant A booking id is invisible under tenant B');
select tests.throws(format($$select public.owner_create_booking(%L, %L, %L, %L, '{"name":"x","phone":"+1 212 5550100"}', '', true, gen_random_uuid())$$,
                           :'tenant_b', :'cut', :'anna', :'mon_1200'),
                    'service_not_found', 'cannot book tenant A service under tenant B');
select tests.throws(format($$select public.owner_set_barber_services(%L, %L, array[%L::uuid])$$, :'tenant_b', :'dave', :'cut'),
                    'service_not_found', 'cannot attach tenant A service to tenant B barber');
select tests.throws($$select * from public.bookings for update$$, '42501', 'no UPDATE privilege on tables for authenticated');
select tests.throws(format($$update public.bookings set snap_price_cents = 1 where id = %L$$, :'bk_b'), '42501', 'direct updates are impossible');
select tests.throws($$select token_hash from public.bookings$$, '42501', 'token_hash column is not readable');

:as_admin
select tests.throws(format($$insert into public.barber_services (tenant_id, barber_id, service_id) values (%L, %L, %L)$$,
                           :'tenant_b', :'dave', :'cut'),
                    '23503', 'composite FK forbids cross-tenant barber_services rows');
select tests.throws(format($$insert into public.bookings (tenant_id, customer_id, barber_id, service_id, starts_at, ends_at, occupied_until, source,
                              snap_service_name, snap_duration_min, snap_buffer_min, snap_price_cents, snap_currency, snap_tenant_name,
                              snap_timezone, snap_policy, snap_barber_name, snap_customer_name, snap_customer_phone)
                              select %L, c.id, %L, %L, now(), now() + interval '1h', now() + interval '1h', 'owner', 'x', 1, 0, 1, 'EUR', 'x', 'UTC', '{}', 'x', 'x', 'x'
                              from public.customers c where c.tenant_id = %L limit 1$$,
                           :'tenant_b', :'anna', :'cut_b', :'tenant_b'),
                    '23503', 'composite FK forbids booking tenant B with tenant A barber');

-- roles inside tenant A ----------------------------------------------------------------------
:as_barber_anna
select tests.eq((select count(*)::int from public.bookings), 1, 'barber sees only own bookings via RLS');
select tests.eq((select count(*)::int from public.payments), 0, 'barber cannot read payments');
select tests.eq(jsonb_array_length(public.owner_calendar(:'tenant_a', :'monday', :'monday') -> 'bookings'), 1,
                'barber calendar limited to own column');
select tests.eq(jsonb_array_length(public.owner_calendar(:'tenant_a', :'monday', :'monday', :'boris') -> 'bookings'), 1,
                'barber cannot widen calendar to another barber');
select tests.throws(format($$select public.owner_cancel_booking(%L, %L)$$, :'tenant_a', :'bk_boris'), 'forbidden', 'barber cannot cancel colleague booking');
select tests.throws(format($$select public.owner_upsert_service(%L, '{"name":"X","duration_min":30,"price_cents":1}')$$, :'tenant_a'),
                    'forbidden', 'barber cannot manage services');
select tests.throws(format($$select public.owner_create_block(%L, %L, %L, %L, 'break')$$, :'tenant_a', :'boris', :'mon_1200', :'mon_1200'::timestamptz + interval '1h'),
                    'forbidden', 'barber cannot block a colleague');
select tests.throws(format($$select public.owner_create_block(%L, null, %L, %L, 'break')$$, :'tenant_a', :'mon_1200', :'mon_1200'::timestamptz + interval '1h'),
                    'forbidden', 'barber cannot block the whole shop');
select tests.ok((public.owner_create_block(:'tenant_a', :'anna', :'mon_1200', :'mon_1200'::timestamptz + interval '30 minutes', 'break') ->> 'block_id') is not null,
                'barber can block own time');
select tests.throws(format($$select public.owner_record_payment(%L, %L, 1000, 'cash', 'payment', '', gen_random_uuid())$$, :'tenant_a', :'bk_anna'),
                    'forbidden', 'barber cannot record payments');
select tests.throws(format($$select public.owner_update_settings(%L, '{"name":"Hacked"}')$$, :'tenant_a'), 'forbidden', 'barber cannot change settings');
select tests.eq((public.owner_stats(:'tenant_a', :'monday', :'monday', :'boris') #>> '{filters,barber_id}'), :'anna',
                'barber stats are forced to own barber');
select tests.throws(format($$select public.owner_create_booking(%L, %L, %L, %L, '{"name":"x","phone":"+49 151 0000009"}', '', false, gen_random_uuid())$$,
                           :'tenant_a', :'cut', :'boris', :'mon_1200'), 'forbidden', 'barber cannot book for a colleague');

:as_admin_a
select tests.throws(format($$select public.owner_update_settings(%L, '{"name":"Admin rename"}')$$, :'tenant_a'), 'forbidden', 'admin cannot change tenant settings');
select tests.throws(format($$select public.owner_go_live(%L)$$, :'tenant_a'), 'forbidden', 'admin cannot go live');
select tests.ok(public.owner_upsert_service(:'tenant_a', '{"name":"Kids cut","duration_min":20,"price_cents":1800}') is not null,
                'admin can create services');
select tests.ok((public.owner_record_payment(:'tenant_a', :'bk_anna', 3000, 'cash', 'payment', '', gen_random_uuid()) ->> 'payment_id') is not null,
                'admin can record payments');
select tests.eq(jsonb_array_length(public.owner_workspace(:'tenant_a') -> 'members'), 0, 'admin does not see member list');

:as_owner_a
select tests.eq(jsonb_array_length(public.owner_workspace(:'tenant_a') -> 'members'), 3, 'owner sees member list');
select public.owner_update_settings(:'tenant_a', '{"tagline":"Fresh"}');
select tests.throws(format($$select public.owner_update_settings(%L, '{"status":"live"}')$$, :'tenant_a'), 'invalid_input', 'status not settable through settings');
select tests.throws(format($$select public.owner_update_settings(%L, '{"logo_path":"%s/owner/x.png"}')$$, :'tenant_a', :'tenant_b'),
                    'invalid_input', 'cannot point logo to another tenant''s storage');

-- Storage policies --------------------------------------------------------------------------
insert into storage.objects (bucket_id, name) values ('tenant-media', :'tenant_a' || '/owner/ok.jpg');
select tests.ok(exists (select 1 from storage.objects where name = :'tenant_a' || '/owner/ok.jpg'), 'owner can upload to own tenant owner/ folder');
select tests.throws(format($$insert into storage.objects (bucket_id, name) values ('tenant-media', %L)$$, :'tenant_b' || '/owner/x.jpg'),
                    '42501', 'owner A cannot upload into tenant B folder');
select tests.throws(format($$insert into storage.objects (bucket_id, name) values ('tenant-media', %L)$$, :'tenant_a' || '/pipeline/x.jpg'),
                    '42501', 'owner cannot overwrite pipeline assets');
:as_barber_anna
select tests.throws(format($$insert into storage.objects (bucket_id, name) values ('tenant-media', %L)$$, :'tenant_a' || '/owner/b.jpg'),
                    '42501', 'barber cannot upload tenant media');
:as_anon
select tests.throws(format($$insert into storage.objects (bucket_id, name) values ('tenant-media', %L)$$, :'tenant_a' || '/owner/c.jpg'),
                    '42501', 'anon cannot upload');

-- Function privileges summary --------------------------------------------------------------
:as_admin
select tests.eq((select count(*)::int from information_schema.routine_privileges
                 where grantee = 'anon' and routine_schema = 'public' and privilege_type = 'EXECUTE'), 10,
                'anon can execute exactly the 10 whitelisted public RPCs');
select tests.eq((select count(*)::int from information_schema.role_table_grants
                 where grantee in ('anon') and table_schema in ('public', 'private')), 0,
                'anon has no table grants');
select tests.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                            where n.nspname = 'public' and p.prosecdef and not exists (
                              select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')),
                'every SECURITY DEFINER function pins search_path');

rollback;
