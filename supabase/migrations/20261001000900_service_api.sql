-- Server-only API (service_role): notification worker, LLM budget, public
-- helper for AI tools, maintenance.

create or replace function private.require_service_role()
returns void language plpgsql stable as $$
begin
  -- Inside SECURITY DEFINER current_user is the owner, so rely on the JWT role.
  -- A direct superuser connection without JWT (migrations, seed, psql) is allowed;
  -- over the Data API session_user is always 'authenticator'.
  if coalesce(auth.role(), '') <> 'service_role'
     and not (auth.role() is null and session_user = 'postgres') then
    perform private.fail('forbidden', 'service_role only');
  end if;
end $$;

-- Who works on a given local date (AI tool + shop page "today").
create or replace function public.get_barbers_on_date(p_slug text, p_date date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_t public.tenants;
  v_date date;
begin
  perform private.public_rate('read', 240, 60);
  v_t := private.tenant_by_slug(p_slug);
  v_date := coalesce(p_date, private.local_today(v_t.timezone));
  return jsonb_build_object(
    'date', v_date, 'timezone', v_t.timezone,
    'barbers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', b.id, 'name', b.name,
               'intervals', (select coalesce(jsonb_agg(jsonb_build_object(
                                 'start', to_char(lower(r) at time zone v_t.timezone, 'HH24:MI'),
                                 'end', to_char(upper(r) at time zone v_t.timezone, 'HH24:MI')) order by lower(r)), '[]'::jsonb)
                             from unnest(private.barber_work_ranges(b.id, v_date)
                                         - coalesce((select range_agg(o.during) from public.resource_occupancies o
                                                     where o.barber_id = b.id and o.active and o.kind = 'block'),
                                                    '{}'::tstzmultirange)) r))
             order by b.sort_order, b.name)
      from public.barbers b where b.tenant_id = v_t.id and b.is_active), '[]'::jsonb));
end $$;

-- Notification worker ----------------------------------------------------------------
create or replace function public.worker_claim_notifications(
  p_worker text, p_limit int default 20, p_lease_seconds int default 120)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_job record;
  v_b record;
  v_t record;
  v_out jsonb := '[]'::jsonb;
  v_deliveries jsonb;
begin
  perform private.require_service_role();
  for v_job in
    select j.* from public.notification_jobs j
    where (j.status = 'pending' and j.run_at <= now())
       or (j.status = 'processing' and j.lease_until < now())
    order by j.run_at
    limit least(greatest(coalesce(p_limit, 20), 1), 100)
    for update skip locked
  loop
    select * into v_b from public.bookings where id = v_job.booking_id;
    select * into v_t from public.tenants where id = v_job.tenant_id;

    -- A crashed worker may have been mid-send: never resend those devices.
    update public.notification_deliveries set status = 'unknown', updated_at = now()
     where job_id = v_job.id and status = 'sending';

    if v_job.attempts >= v_job.max_attempts then
      update public.notification_jobs set status = 'failed', status_reason = 'max_attempts',
             completed_at = now(), lease_until = null where id = v_job.id;
      continue;
    end if;
    if v_t.status <> 'live' or v_b.is_demo then
      update public.notification_jobs set status = 'skipped', status_reason = 'not_live', completed_at = now()
       where id = v_job.id;
      continue;
    end if;
    if v_job.booking_version <> v_b.version
       or (v_job.event = 'reminder' and (v_b.status <> 'confirmed' or v_b.starts_at <= now())) then
      update public.notification_jobs set status = 'cancelled', status_reason = 'superseded', completed_at = now()
       where id = v_job.id;
      continue;
    end if;

    insert into public.notification_deliveries (job_id, subscription_id)
    select v_job.id, ps.id
    from public.push_subscriptions ps
    where ps.tenant_id = v_job.tenant_id and ps.disabled_at is null
      and ((v_job.audience = 'customer' and ps.audience = 'customer' and ps.booking_id = v_job.booking_id)
        or (v_job.audience = 'staff' and ps.audience = 'staff' and exists (
              select 1 from public.memberships m where m.tenant_id = v_job.tenant_id and m.user_id = ps.user_id
                and (m.role in ('owner', 'admin') or m.barber_id = v_b.barber_id))))
    on conflict do nothing;

    select coalesce(jsonb_agg(jsonb_build_object('subscription_id', ps.id, 'endpoint', ps.endpoint,
                                                 'p256dh', ps.p256dh, 'auth', ps.auth_secret)), '[]'::jsonb)
      into v_deliveries
    from public.notification_deliveries d join public.push_subscriptions ps on ps.id = d.subscription_id
    where d.job_id = v_job.id and d.status = 'pending' and ps.disabled_at is null;

    if jsonb_array_length(v_deliveries) = 0 then
      update public.notification_jobs
         set status = case when exists (select 1 from public.notification_deliveries d
                                         where d.job_id = v_job.id and d.status = 'sent') then 'sent' else 'skipped' end,
             status_reason = 'no_pending_subscription', completed_at = now(), lease_until = null
       where id = v_job.id;
      continue;
    end if;

    update public.notification_deliveries set status = 'sending', updated_at = now()
     where job_id = v_job.id and status = 'pending';
    update public.notification_jobs
       set status = 'processing', attempts = attempts + 1, leased_by = p_worker,
           lease_until = now() + make_interval(secs => greatest(coalesce(p_lease_seconds, 120), 10))
     where id = v_job.id;

    v_out := v_out || jsonb_build_object(
      'job_id', v_job.id, 'audience', v_job.audience, 'event', v_job.event,
      'tenant', jsonb_build_object('slug', v_t.slug, 'name', v_t.name, 'locale', v_t.locale,
                                   'timezone', v_t.timezone, 'accent_color', v_t.accent_color),
      'booking', jsonb_build_object('id', v_b.id, 'status', v_b.status, 'starts_at', v_b.starts_at,
                                    'service_name', v_b.snap_service_name, 'barber_name', v_b.snap_barber_name,
                                    'customer_name', v_b.snap_customer_name, 'timezone', v_b.snap_timezone),
      'deliveries', v_deliveries);
  end loop;
  return v_out;
end $$;

-- p_results: [{subscription_id, outcome: sent|gone|retry|failed, http_status}]
create or replace function public.worker_complete_notification(
  p_job_id uuid, p_worker text, p_results jsonb, p_error text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_job record;
  v_r jsonb;
  v_retry boolean := false;
  v_sent boolean;
begin
  perform private.require_service_role();
  select * into v_job from public.notification_jobs where id = p_job_id for update;
  if v_job.id is null or v_job.status <> 'processing' or v_job.leased_by is distinct from p_worker then
    return jsonb_build_object('accepted', false, 'reason', 'lease_lost');
  end if;
  for v_r in select * from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) loop
    update public.notification_deliveries
       set status = case v_r ->> 'outcome' when 'sent' then 'sent' when 'gone' then 'gone'
                                          when 'retry' then 'pending' else 'failed' end,
           http_status = (v_r ->> 'http_status')::int, updated_at = now()
     where job_id = p_job_id and subscription_id = (v_r ->> 'subscription_id')::uuid and status = 'sending';
    if v_r ->> 'outcome' = 'gone' then
      update public.push_subscriptions set disabled_at = now() where id = (v_r ->> 'subscription_id')::uuid;
    elsif v_r ->> 'outcome' = 'sent' then
      update public.push_subscriptions set last_success_at = now() where id = (v_r ->> 'subscription_id')::uuid;
    elsif v_r ->> 'outcome' = 'retry' then
      v_retry := true;
    end if;
  end loop;
  -- Anything still 'sending' was not reported: treat as unknown (no resend).
  update public.notification_deliveries set status = 'unknown', updated_at = now()
   where job_id = p_job_id and status = 'sending';

  v_sent := exists (select 1 from public.notification_deliveries where job_id = p_job_id and status = 'sent');
  if v_retry and v_job.attempts < v_job.max_attempts then
    update public.notification_jobs
       set status = 'pending', lease_until = null, leased_by = null, last_error = left(p_error, 500),
           run_at = now() + make_interval(secs => 30 * power(2, v_job.attempts)::int)
     where id = p_job_id;
  else
    update public.notification_jobs
       set status = case when v_sent then 'sent' else 'failed' end,
           status_reason = case when v_sent then null else 'delivery_failed' end,
           last_error = left(p_error, 500), lease_until = null, completed_at = now()
     where id = p_job_id;
  end if;
  return jsonb_build_object('accepted', true);
end $$;

-- LLM budget -----------------------------------------------------------------------------
create or replace function public.ai_reserve(
  p_tenant_id uuid, p_estimated_tokens int, p_global_daily_requests int, p_global_daily_tokens bigint,
  p_client_key text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.tenants;
  v_day date;
  v_row int;
begin
  perform private.require_service_role();
  select * into t from public.tenants where id = p_tenant_id;
  if t.id is null or t.status not in ('preview', 'live') then
    return jsonb_build_object('allowed', false, 'reason', 'tenant_unavailable');
  end if;
  if not t.ai_enabled then
    return jsonb_build_object('allowed', false, 'reason', 'ai_disabled');
  end if;
  if p_client_key is not null and not private.rate_hit('ai:' || p_client_key, 20, 300) then
    return jsonb_build_object('allowed', false, 'reason', 'rate_limited');
  end if;
  v_day := private.local_today(t.timezone);
  begin
    v_row := null;
    insert into private.llm_usage as u (tenant_id, day, requests, tokens)
    values (t.id, v_day, 1, p_estimated_tokens)
    on conflict (day, tenant_id) do update
      set requests = u.requests + 1, tokens = u.tokens + p_estimated_tokens
      where u.requests < t.ai_daily_request_limit and u.tokens + p_estimated_tokens <= t.ai_daily_token_limit
    returning requests into v_row;
    if v_row is null or v_row > t.ai_daily_request_limit or p_estimated_tokens > t.ai_daily_token_limit then
      raise exception using errcode = 'P0002', message = 'tenant_budget';
    end if;
    v_row := null;
    insert into private.llm_usage as u (tenant_id, day, requests, tokens)
    values ('00000000-0000-0000-0000-000000000000', (now() at time zone 'UTC')::date, 1, p_estimated_tokens)
    on conflict (day, tenant_id) do update
      set requests = u.requests + 1, tokens = u.tokens + p_estimated_tokens
      where u.requests < p_global_daily_requests and u.tokens + p_estimated_tokens <= p_global_daily_tokens
    returning requests into v_row;
    if v_row is null or v_row > p_global_daily_requests or p_estimated_tokens > p_global_daily_tokens then
      raise exception using errcode = 'P0002', message = 'global_budget';
    end if;
  exception when sqlstate 'P0002' then
    return jsonb_build_object('allowed', false, 'reason', sqlerrm);
  end;
  return jsonb_build_object('allowed', true, 'day', v_day);
end $$;

-- Correct the reservation with real usage (may be negative).
create or replace function public.ai_commit_usage(p_tenant_id uuid, p_day date, p_token_delta int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_service_role();
  update private.llm_usage set tokens = greatest(tokens + p_token_delta, 0)
   where tenant_id = p_tenant_id and day = p_day;
  update private.llm_usage set tokens = greatest(tokens + p_token_delta, 0)
   where tenant_id = '00000000-0000-0000-0000-000000000000' and day = (now() at time zone 'UTC')::date;
end $$;

create or replace function public.ai_usage(p_tenant_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare t public.tenants;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    perform private.require_member(p_tenant_id, array['owner', 'admin']);
  end if;
  select * into t from public.tenants where id = p_tenant_id;
  return jsonb_build_object(
    'day', private.local_today(t.timezone),
    'requests', coalesce((select requests from private.llm_usage where tenant_id = t.id and day = private.local_today(t.timezone)), 0),
    'tokens', coalesce((select tokens from private.llm_usage where tenant_id = t.id and day = private.local_today(t.timezone)), 0),
    'request_limit', t.ai_daily_request_limit, 'token_limit', t.ai_daily_token_limit, 'enabled', t.ai_enabled);
end $$;

-- Owner role check for edge functions acting with the user's JWT.
create or replace function public.owner_membership(p_tenant_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare m public.memberships;
begin
  m := private.require_member(p_tenant_id, array['owner', 'admin', 'barber']);
  return jsonb_build_object('role', m.role, 'barber_id', m.barber_id);
end $$;

create or replace function public.worker_maintenance()
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_service_role();
  perform private.cleanup_counters();
  delete from public.idempotency_records where created_at < now() - interval '30 days';
end $$;
