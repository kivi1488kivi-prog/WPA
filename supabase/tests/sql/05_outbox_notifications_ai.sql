-- Outbox (create/reschedule/cancel), dedupe, lease, at-most-once delivery,
-- preview suppression, timezone in payload, LLM budget, public rate limits, AI scopes.
begin;
\i supabase/tests/sql/_fixtures.sql

select private.local_ts(:'monday', 600, 'Europe/Berlin') as mon_1000,
       private.local_ts(:'monday', 840, 'Europe/Berlin') as mon_1400,
       private.local_ts(:'monday', 540, 'America/New_York') as b_mon_0900 \gset

:as_anon
select public.create_booking('test-a', :'cut', :'anna', :'mon_1000', '{"name":"Ivan","phone":"+49 151 1111111"}',
                             'dddddddd-0000-0000-0000-000000000001') as r1 \gset
select (:'r1'::jsonb ->> 'booking_id') as b1, (:'r1'::jsonb ->> 'token') as t1 \gset
:as_admin
select tests.eq((select count(*)::int from public.notification_jobs where booking_id = :'b1'), 3,
                'create enqueues staff notice + 2 reminders');
select tests.eq((select string_agg(audience || ':' || event, ',' order by audience, event) from public.notification_jobs where booking_id = :'b1'),
                'customer:reminder,customer:reminder,staff:created', 'job kinds for client-created booking');
select tests.ok((select bool_and(run_at < (select starts_at from public.bookings where id = :'b1'))
                 from public.notification_jobs where booking_id = :'b1' and event = 'reminder'), 'reminders scheduled before the visit');

-- Retry of the same request does not enqueue again (dedupe)
:as_anon
select public.create_booking('test-a', :'cut', :'anna', :'mon_1000', '{"name":"Ivan","phone":"+49 151 1111111"}',
                             'dddddddd-0000-0000-0000-000000000001');
:as_admin
select tests.eq((select count(*)::int from public.notification_jobs where booking_id = :'b1'), 3, 'retry does not duplicate jobs');
select tests.throws(format($$insert into public.notification_jobs (tenant_id, booking_id, booking_version, audience, event, dedupe_key)
                              values (%L, %L, 1, 'staff', 'created', 'b:%s:v1:created:staff')$$, :'tenant_a', :'b1', :'b1'),
                    '23505', 'dedupe_key is unique');

-- Reschedule supersedes old reminders and plans new ones
:as_anon
select public.reschedule_booking_by_token(:'t1', :'mon_1400', null, false, gen_random_uuid());
:as_admin
select tests.eq((select count(*)::int from public.notification_jobs where booking_id = :'b1' and booking_version = 1 and event = 'reminder' and status = 'cancelled'), 2,
                'reschedule cancels v1 reminders');
select tests.eq((select count(*)::int from public.notification_jobs where booking_id = :'b1' and booking_version = 2 and event = 'reminder' and status = 'pending'), 2,
                'reschedule plans v2 reminders');
select tests.ok((select bool_and(run_at in (private.local_ts(:'monday', 840, 'Europe/Berlin') - interval '1 day', private.local_ts(:'monday', 840, 'Europe/Berlin') - interval '2 hours'))
                 from public.notification_jobs where booking_id = :'b1' and booking_version = 2 and event = 'reminder'),
                'v2 reminders aligned to the new time');
select tests.eq((select count(*)::int from public.notification_jobs where booking_id = :'b1' and event = 'rescheduled' and audience = 'staff'), 1,
                'staff notified about client reschedule');

-- Owner cancels -> customer notified, reminders cancelled
:as_owner_a
select public.owner_cancel_booking(:'tenant_a', :'b1', 'sick');
:as_admin
select tests.eq((select count(*)::int from public.notification_jobs where booking_id = :'b1' and status = 'pending' and event = 'reminder'), 0,
                'cancel leaves no pending reminders');
select tests.eq((select count(*)::int from public.notification_jobs where booking_id = :'b1' and audience = 'customer' and event = 'cancelled' and status = 'pending'), 1,
                'customer gets a cancellation notice for staff cancel');

-- Preview tenants never send ----------------------------------------------------------------
update public.tenants set status = 'preview' where id = :'tenant_b';
:as_anon
select public.create_booking('test-b', :'cut_b', :'dave', :'b_mon_0900', '{"name":"Bob","phone":"+1 212 5550199"}', gen_random_uuid()) as rb \gset
:as_admin
select tests.ok((select bool_and(status = 'skipped') from public.notification_jobs where booking_id = (:'rb'::jsonb ->> 'booking_id')::uuid),
                'preview tenant: all jobs skipped (no real notifications)');
update public.tenants set status = 'live' where id = :'tenant_b';

-- Worker: claim / lease / complete -----------------------------------------------------------
:as_anon
select public.create_booking('test-a', :'cut', :'boris', :'mon_1000', '{"name":"Petr","phone":"+49 151 2222222"}', gen_random_uuid()) as r2 \gset
select public.create_booking('test-a', :'cut', :'anna', :'mon_1000', '{"name":"Olga","phone":"+49 151 3333333"}', gen_random_uuid()) as r3 \gset
select public.register_customer_push(:'r2'::jsonb ->> 'token',
  '{"endpoint":"https://push.example/cust-1","keys":{"p256dh":"BPcustomerkeyBPcustomerkeyBPcustomerkeyBPcustomerkeyBPcustomerkey00","auth":"authsecret000000"}}');
:as_owner_a
select public.owner_register_push(:'tenant_a',
  '{"endpoint":"https://push.example/owner-1","keys":{"p256dh":"BPownerkeyBPownerkeyBPownerkeyBPownerkeyBPownerkeyBPownerkey00","auth":"authsecret000000"}}');
:as_barber_anna
select public.owner_register_push(:'tenant_a',
  '{"endpoint":"https://push.example/anna-1","keys":{"p256dh":"BPannakeyBPannakeyBPannakeyBPannakeyBPannakeyBPannakeyBPanna00","auth":"authsecret000000"}}');

:as_service
select public.worker_claim_notifications('worker-1', 50, 120) as claim1 \gset
select tests.ok(jsonb_array_length(:'claim1'::jsonb) >= 2, 'worker claims due staff jobs');
select tests.ok(not exists (select 1 from jsonb_array_elements(:'claim1'::jsonb) j
                            where j ->> 'event' = 'reminder'), 'future reminders not claimed yet');
select tests.eq((select count(*)::int from jsonb_array_elements(:'claim1'::jsonb) j, jsonb_array_elements(j -> 'deliveries') d
                 where j #>> '{booking,id}' = :'r2'::jsonb ->> 'booking_id'), 1,
                'Boris booking: only owner device (barber Anna is not targeted)');
select tests.eq((select count(*)::int from jsonb_array_elements(:'claim1'::jsonb) j, jsonb_array_elements(j -> 'deliveries') d
                 where j #>> '{booking,id}' = :'r3'::jsonb ->> 'booking_id'), 2,
                'Anna booking: owner + Anna devices');
select tests.eq((select j #>> '{tenant,timezone}' from jsonb_array_elements(:'claim1'::jsonb) j limit 1), 'Europe/Berlin',
                'payload carries tenant timezone for formatting');
select tests.eq(jsonb_array_length(public.worker_claim_notifications('worker-2', 50, 120)), 0,
                'leased jobs are not claimed by a second worker');

select (select j ->> 'job_id' from jsonb_array_elements(:'claim1'::jsonb) j where j #>> '{booking,id}' = :'r2'::jsonb ->> 'booking_id') as job_r2,
       (select j #>> '{deliveries,0,subscription_id}' from jsonb_array_elements(:'claim1'::jsonb) j where j #>> '{booking,id}' = :'r2'::jsonb ->> 'booking_id') as sub_owner,
       (select j ->> 'job_id' from jsonb_array_elements(:'claim1'::jsonb) j where j #>> '{booking,id}' = :'r3'::jsonb ->> 'booking_id') as job_r3 \gset
select tests.eq((public.worker_complete_notification(:'job_r2', 'worker-2', '[]') ->> 'accepted')::boolean, false,
                'completion from a foreign worker is rejected (lease)');
select public.worker_complete_notification(:'job_r2', 'worker-1',
  jsonb_build_array(jsonb_build_object('subscription_id', :'sub_owner', 'outcome', 'sent', 'http_status', 201)));
:as_admin
select tests.eq((select status from public.notification_jobs where id = :'job_r2'), 'sent', 'job marked sent');

-- Crash simulation: worker-1 never completes job_r3; lease expires.
update public.notification_jobs set lease_until = now() - interval '1 second' where id = :'job_r3';
:as_service
select public.worker_claim_notifications('worker-3', 50, 120) as claim2 \gset
select tests.ok(not exists (select 1 from jsonb_array_elements(:'claim2'::jsonb) j where j ->> 'job_id' = :'job_r3'),
                'expired lease: devices possibly reached are not re-sent (at-most-once)');
:as_admin
select tests.ok((select bool_and(status = 'unknown') from public.notification_deliveries where job_id = :'job_r3'),
                'in-flight deliveries marked unknown after crash');

-- Retry + gone handling on a fresh job
:as_owner_a
select public.owner_reschedule_booking(:'tenant_a', (:'r2'::jsonb ->> 'booking_id')::uuid, :'mon_1400', null, false, gen_random_uuid());
:as_service
select public.worker_claim_notifications('worker-4', 50, 120) as claim3 \gset
select (select j ->> 'job_id' from jsonb_array_elements(:'claim3'::jsonb) j where j ->> 'audience' = 'customer') as job_c,
       (select j #>> '{deliveries,0,subscription_id}' from jsonb_array_elements(:'claim3'::jsonb) j where j ->> 'audience' = 'customer') as sub_c \gset
select tests.ok(:'job_c' <> '', 'customer receives reschedule-by-staff notice');
select public.worker_complete_notification(:'job_c', 'worker-4',
  jsonb_build_array(jsonb_build_object('subscription_id', :'sub_c', 'outcome', 'retry', 'http_status', 503)), 'push service 503');
:as_admin
select tests.ok((select status = 'pending' and run_at > now() from public.notification_jobs where id = :'job_c'), 'transient failure re-queued with backoff');
update public.notification_jobs set run_at = now() - interval '1 second' where id = :'job_c';
:as_service
select public.worker_claim_notifications('worker-5', 50, 120) as claim4 \gset
select tests.ok(exists (select 1 from jsonb_array_elements(:'claim4'::jsonb) j where j ->> 'job_id' = :'job_c'), 'retried job claimed again');
select public.worker_complete_notification(:'job_c', 'worker-5',
  jsonb_build_array(jsonb_build_object('subscription_id', :'sub_c', 'outcome', 'gone', 'http_status', 410)));
:as_admin
select tests.ok((select disabled_at is not null from public.push_subscriptions where id = :'sub_c'), '410 Gone disables the subscription');

-- Stale reminder version is superseded at claim time
insert into public.notification_jobs (tenant_id, booking_id, booking_version, audience, event, dedupe_key, run_at)
values (:'tenant_a', (:'r2'::jsonb ->> 'booking_id')::uuid, 1, 'customer', 'reminder', 'stale-test', now() - interval '1 minute');
:as_service
select public.worker_claim_notifications('worker-6', 50, 120);
:as_admin
select tests.eq((select status || ':' || status_reason from public.notification_jobs where dedupe_key = 'stale-test'), 'cancelled:superseded',
                'stale-version reminder cancelled instead of sent');

-- LLM budget --------------------------------------------------------------------------------------
update public.tenants set ai_daily_request_limit = 2, ai_daily_token_limit = 1000 where id = :'tenant_a';
:as_service
select tests.ok((public.ai_reserve(:'tenant_a', 300, 1000, 100000) ->> 'allowed')::boolean, 'AI budget: 1st request allowed');
select tests.ok((public.ai_reserve(:'tenant_a', 300, 1000, 100000) ->> 'allowed')::boolean, 'AI budget: 2nd request allowed');
select tests.eq(public.ai_reserve(:'tenant_a', 300, 1000, 100000) ->> 'reason', 'tenant_budget', 'AI budget: 3rd request refused (tenant daily cap)');
select tests.eq((public.ai_usage(:'tenant_a') ->> 'requests')::int, 2, 'refused request did not increment the counter');
select tests.eq(public.ai_reserve(:'tenant_b', 300, 2, 100000) ->> 'reason', 'global_budget', 'global daily cap applies across tenants');
select tests.eq((public.ai_usage(:'tenant_b') ->> 'requests')::int, 0, 'global refusal rolls back tenant increment');
select public.ai_commit_usage(:'tenant_a', (public.ai_usage(:'tenant_a') ->> 'day')::date, -200);
select tests.eq((public.ai_usage(:'tenant_a') ->> 'tokens')::int, 400, 'actual usage correction applied');
:as_admin
update public.tenants set ai_enabled = false where id = :'tenant_b';
:as_service
select tests.eq(public.ai_reserve(:'tenant_b', 1, 1000, 100000) ->> 'reason', 'ai_disabled', 'AI disabled per tenant');
select tests.eq((select count(*)::int from generate_series(1, 21) i
                 where (public.ai_reserve(:'tenant_a', 0, 100000, 100000000, 'ip-1.2.3.4') ->> 'reason') = 'rate_limited'), 1,
                'per-client AI rate limit (20 / 5 min) trips on the 21st call');

-- AI scopes: owner tools need membership; anon has only public tools ------------------------------
:as_anon
select tests.throws(format($$select public.owner_stats(%L, current_date, current_date)$$, :'tenant_a'), '42501', 'anon (client AI scope) cannot run owner tools');
:as_owner_b
select tests.throws(format($$select public.owner_membership(%L)$$, :'tenant_a'), 'forbidden', 'owner of B has no AI owner scope in A');
:as_barber_anna
select tests.eq(public.owner_membership(:'tenant_a') ->> 'role', 'barber', 'membership role resolved server-side for AI scope');

-- Public rate limit (successful requests count) ----------------------------------------------------
:as_anon
select set_config('request.headers', '{"x-forwarded-for":"203.0.113.9"}', true);
select count(*) from (
  select public.create_booking('test-a', :'cut', null, private_ts, jsonb_build_object('name', 'R' || i, 'phone', '+49 151 90000' || lpad(i::text, 2, '0')), gen_random_uuid())
  from (select i, (:'mon_1000'::timestamptz + make_interval(days => 1 + i / 6, mins => (i % 6) * 60)) as private_ts
        from generate_series(1, 12) i) s) x;
select tests.throws(format($$select public.create_booking('test-a', %L, null, %L::timestamptz + interval '3 days', '{"name":"R13","phone":"+49 151 9000013"}', gen_random_uuid())$$,
                           :'cut', :'mon_1000'),
                    'rate_limited', '13th booking from one IP within 10 min is rate limited');
select set_config('request.headers', '{"x-forwarded-for":"198.51.100.7"}', true);
select tests.ok((public.create_booking('test-a', :'cut', null, :'mon_1000'::timestamptz + interval '3 days 2 hours',
                 '{"name":"Other","phone":"+49 151 9000099"}', gen_random_uuid()) ->> 'booking_id') is not null,
                'another IP is not affected');

rollback;
