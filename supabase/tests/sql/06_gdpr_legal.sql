-- GDPR export/anonymization, retention, legal data and go-live gating.
begin;
\i supabase/tests/sql/_fixtures.sql

select private.local_ts(:'monday', 600, 'Europe/Berlin') as mon_1000,
       private.local_ts(current_date - 800, 600, 'Europe/Berlin') as old_1000 \gset

:as_anon
select tests.eq(public.get_tenant_public('test-a') #>> '{tenant,legal,impressum,legal_name}', 'Test Shop A GmbH', 'Impressum data is public');
select tests.eq((public.get_tenant_public('test-a') #>> '{tenant,retention_months}')::int, 24, 'retention period published for the privacy notice');
select public.create_booking('test-a', :'cut', :'anna', :'mon_1000', '{"name":"Ivan Petrov","phone":"+49 151 1111111","email":"ivan@example.com"}', gen_random_uuid()) as r1 \gset
select (:'r1'::jsonb ->> 'token') as t1 \gset

:as_admin
select id as cust from public.customers where phone_normalized = '+491511111111' \gset

:as_admin_a
select tests.eq(public.owner_export_customer(:'tenant_a', :'cust') #>> '{customer,email}', 'ivan@example.com', 'admin can export customer data (Art. 15/20)');
select tests.eq(jsonb_array_length(public.owner_export_customer(:'tenant_a', :'cust') -> 'bookings'), 1, 'export includes bookings');
select tests.throws(format($$select public.owner_anonymize_customer(%L, %L)$$, :'tenant_a', :'cust'), 'forbidden', 'only the owner may anonymize');
:as_owner_b
select tests.throws(format($$select public.owner_export_customer(%L, %L)$$, :'tenant_a', :'cust'), 'forbidden', 'other tenant cannot export');
:as_anon
select tests.throws(format($$select public.owner_export_customer(%L, %L)$$, :'tenant_a', :'cust'), '42501', 'anon cannot export');

:as_owner_a
select tests.throws(format($$select public.owner_anonymize_customer(%L, %L)$$, :'tenant_a', :'cust'), 'invalid_transition',
                    'customer with upcoming booking cannot be anonymized');
select public.owner_record_payment(:'tenant_a', (:'r1'::jsonb ->> 'booking_id')::uuid, 1000, 'cash', 'payment', '', gen_random_uuid()) is not null as dummy \gset
select public.owner_cancel_booking(:'tenant_a', (:'r1'::jsonb ->> 'booking_id')::uuid, 'gdpr request');
select tests.ok((public.owner_anonymize_customer(:'tenant_a', :'cust') ->> 'bookings_anonymized')::int = 1, 'owner anonymizes customer (Art. 17)');
:as_admin
select tests.ok((select name = '—' and email is null and anonymized_at is not null from public.customers where id = :'cust'), 'customer row anonymized');
select tests.ok((select snap_customer_name = '—' and snap_customer_email is null and snap_price_cents = 3000 from public.bookings where customer_id = :'cust'),
                'booking personal snapshot erased, financial snapshot kept');
select tests.ok(not exists (select 1 from public.bookings b where b.customer_id = :'cust' and to_jsonb(b)::text like '%Ivan%'), 'no trace of the name in bookings');
select tests.eq((select count(*)::int from public.payments p join public.bookings b on b.id = p.booking_id where b.customer_id = :'cust'), 1, 'payment facts retained for bookkeeping');
select tests.throws(format($$update public.bookings set snap_customer_name = 'X' where customer_id = %L$$, :'cust'), 'immutable_snapshot',
                    'outside the anonymization path personal snapshots stay immutable');
:as_anon
select tests.eq(public.get_booking_by_token(:'t1') #>> '{customer,name}', '—', 'token view shows anonymized data');

-- Retention: old visit beyond retention period gets anonymized automatically
:as_owner_a
select public.owner_create_booking(:'tenant_a', :'cut', :'boris', :'old_1000', '{"name":"Old Client","phone":"+49 151 2222222"}', '', true, gen_random_uuid());
:as_admin
update public.customers set created_at = now() - interval '800 days' where phone_normalized = '+491512222222';
:as_service
select tests.ok((public.worker_retention() ->> 'customers_anonymized')::int >= 1, 'retention job anonymizes customers past retention period');
:as_admin
select tests.ok((select anonymized_at is not null from public.customers where phone_normalized like 'anon:%' and id <> :'cust' limit 1), 'old customer anonymized');

-- Go-live requires a complete Impressum
update public.tenants set status = 'preview' where id = :'tenant_b';
:as_owner_b
select tests.ok(tests.error_detail(format($$select public.owner_go_live(%L)$$, :'tenant_b')) like '%missing_impressum%',
                'go-live blocked without Impressum');
select public.owner_update_settings(:'tenant_b', '{"legal":{"impressum":{"legal_name":"B LLC","street":"Ave 2","postal_code":"10004","city":"New York","email":"b@test.local"}}}');
select tests.eq(public.owner_go_live(:'tenant_b') ->> 'status', 'live', 'go-live after Impressum is complete');
select tests.throws(format($$select public.owner_update_settings(%L, '{"locale":"fr"}')$$, :'tenant_b'), 'invalid_input', 'unsupported locale rejected');
select public.owner_update_settings(:'tenant_b', '{"locale":"de"}');
:as_anon
select tests.eq(public.get_tenant_public('test-b') #>> '{tenant,locale}', 'de', 'German locale supported');

rollback;
