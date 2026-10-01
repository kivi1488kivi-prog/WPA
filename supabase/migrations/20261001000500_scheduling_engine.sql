-- Scheduling engine: working ranges, slot validation, slot generation, block
-- materialization and the atomic create / reschedule / cancel primitives.
-- Everything here is private; public & owner RPCs wrap these with auth checks.

-- Working ranges of a barber on a local date (tenant timezone), as instants.
create or replace function private.barber_work_ranges(p_barber_id uuid, p_date date)
returns tstzmultirange language plpgsql stable security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_tz text;
  v_dow int := extract(isodow from p_date)::int;
  v_work tstzmultirange;
begin
  select b.tenant_id, t.timezone into v_tenant, v_tz
  from public.barbers b join public.tenants t on t.id = b.tenant_id
  where b.id = p_barber_id;
  if v_tenant is null then
    return '{}'::tstzmultirange;
  end if;

  if exists (select 1 from public.schedule_overrides o
             where o.barber_id = p_barber_id and o.on_date = p_date) then
    select coalesce(range_agg(tstzrange(private.local_ts(p_date, o.start_min, v_tz),
                                        private.local_ts(p_date, o.end_min, v_tz))), '{}')
      into v_work
    from public.schedule_overrides o
    where o.barber_id = p_barber_id and o.on_date = p_date and o.start_min is not null;
  else
    select coalesce(range_agg(tstzrange(private.local_ts(p_date, h.start_min, v_tz),
                                        private.local_ts(p_date, h.end_min, v_tz))), '{}')
      into v_work
    from public.barber_weekly_hours h
    where h.barber_id = p_barber_id and h.weekday = v_dow;

    v_work := v_work - coalesce((
      select range_agg(tstzrange(private.local_ts(p_date, k.start_min, v_tz),
                                 private.local_ts(p_date, k.end_min, v_tz)))
      from public.barber_weekly_breaks k
      where k.barber_id = p_barber_id and k.weekday = v_dow), '{}'::tstzmultirange);
  end if;

  -- Shop-wide special date: intersect (closed row => empty).
  if exists (select 1 from public.schedule_overrides o
             where o.tenant_id = v_tenant and o.barber_id is null and o.on_date = p_date) then
    v_work := v_work * coalesce((
      select range_agg(tstzrange(private.local_ts(p_date, o.start_min, v_tz),
                                 private.local_ts(p_date, o.end_min, v_tz)))
      from public.schedule_overrides o
      where o.tenant_id = v_tenant and o.barber_id is null and o.on_date = p_date
        and o.start_min is not null), '{}'::tstzmultirange);
  end if;

  return v_work;
end $$;

-- Weekly breaks of a barber on a date (for calendar rendering only).
create or replace function private.barber_break_ranges(p_barber_id uuid, p_date date)
returns tstzmultirange language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.schedule_overrides o where o.barber_id = p_barber_id and o.on_date = p_date)
      then '{}'::tstzmultirange
    else coalesce((
      select range_agg(tstzrange(private.local_ts(p_date, k.start_min, t.timezone),
                                 private.local_ts(p_date, k.end_min, t.timezone)))
      from public.barber_weekly_breaks k
      join public.tenants t on t.id = k.tenant_id
      where k.barber_id = p_barber_id and k.weekday = extract(isodow from p_date)::int), '{}'::tstzmultirange)
  end
$$;

-- Validate one concrete slot. Returns NULL when bookable, otherwise a reason code.
create or replace function private.check_slot(
  p_barber_id uuid, p_service_id uuid, p_start timestamptz,
  p_duration_min int, p_buffer_min int,
  p_check_hours boolean, p_exclude_booking uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_b record;
  v_tz text;
  v_local_date date;
  v_service_range tstzrange;
  v_occ_range tstzrange;
begin
  select b.id, b.tenant_id, b.is_active into v_b from public.barbers b where b.id = p_barber_id;
  if v_b.id is null or not v_b.is_active then
    return 'barber_inactive';
  end if;
  if not exists (select 1 from public.barber_services bs
                 where bs.barber_id = p_barber_id and bs.service_id = p_service_id) then
    return 'service_not_offered';
  end if;
  select t.timezone into v_tz from public.tenants t where t.id = v_b.tenant_id;
  v_local_date := (p_start at time zone v_tz)::date;
  v_service_range := tstzrange(p_start, p_start + make_interval(mins => p_duration_min));
  v_occ_range := tstzrange(p_start, p_start + make_interval(mins => p_duration_min + p_buffer_min));

  if p_check_hours and not (private.barber_work_ranges(p_barber_id, v_local_date) @> v_service_range) then
    return 'outside_hours';
  end if;

  if exists (select 1 from public.resource_occupancies o
             where o.barber_id = p_barber_id and o.active and o.during && v_occ_range
               and (p_exclude_booking is null or o.booking_id is distinct from p_exclude_booking)) then
    return 'conflict';
  end if;
  return null;
end $$;

-- Generate bookable start instants for a local date.
-- p_barber_id NULL = every eligible barber ("any available").
create or replace function private.compute_slots(
  p_tenant_id uuid, p_service_id uuid, p_barber_id uuid, p_date date,
  p_apply_lead boolean default true)
returns table (starts_at timestamptz, barber_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_t record;
  v_s record;
  v_b record;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_work tstzmultirange;
  v_occ tstzmultirange;
  v_earliest timestamptz;
begin
  select t.* into v_t from public.tenants t where t.id = p_tenant_id;
  select s.* into v_s from public.services s where s.id = p_service_id and s.tenant_id = p_tenant_id;
  if v_t.id is null or v_s.id is null or not v_s.is_active then
    return;
  end if;
  v_day_start := private.local_ts(p_date, 0, v_t.timezone);
  v_day_end := private.local_ts(p_date + 1, 0, v_t.timezone);
  v_earliest := case when p_apply_lead then now() + make_interval(mins => v_t.min_lead_min) else '-infinity'::timestamptz end;

  for v_b in
    select b.id from public.barbers b
    join public.barber_services bs on bs.barber_id = b.id and bs.service_id = p_service_id
    where b.tenant_id = p_tenant_id and b.is_active
      and (p_barber_id is null or b.id = p_barber_id)
  loop
    v_work := private.barber_work_ranges(v_b.id, p_date);
    if isempty(v_work) then
      continue;
    end if;
    select coalesce(range_agg(o.during), '{}') into v_occ
    from public.resource_occupancies o
    where o.barber_id = v_b.id and o.active
      and o.during && tstzrange(v_day_start - interval '1 day', v_day_end + interval '1 day');

    return query
      select g.s, v_b.id
      from generate_series(v_day_start,
                           v_day_end - make_interval(mins => v_s.duration_min),
                           make_interval(mins => v_t.slot_step_min)) as g(s)
      where g.s >= v_earliest
        and v_work @> tstzrange(g.s, g.s + make_interval(mins => v_s.duration_min))
        and not (v_occ && tstzrange(g.s, g.s + make_interval(mins => v_s.duration_min + v_s.buffer_min)));
  end loop;
end $$;

-- Materialize a block into per-barber occupancies (shop-wide = every barber).
create or replace function private.materialize_block(p_block_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_blk record;
begin
  select * into v_blk from public.time_blocks where id = p_block_id;
  insert into public.resource_occupancies (tenant_id, barber_id, during, kind, block_id)
  select v_blk.tenant_id, b.id, v_blk.during, 'block', v_blk.id
  from public.barbers b
  where b.tenant_id = v_blk.tenant_id
    and (v_blk.barber_id is null or b.id = v_blk.barber_id);
end $$;

-- Bookings that would collide with a prospective block.
create or replace function private.block_conflicts(p_tenant_id uuid, p_barber_id uuid, p_during tstzrange)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'booking_id', bk.id, 'barber_id', bk.barber_id, 'barber_name', bk.snap_barber_name,
           'starts_at', bk.starts_at, 'customer_name', bk.snap_customer_name,
           'service_name', bk.snap_service_name) order by bk.starts_at), '[]'::jsonb)
  from public.resource_occupancies o
  join public.bookings bk on bk.id = o.booking_id
  where o.tenant_id = p_tenant_id and o.active and o.kind = 'booking'
    and (p_barber_id is null or o.barber_id = p_barber_id)
    and o.during && p_during
$$;

-- New barbers inherit future shop-wide blocks.
create or replace function private.barbers_inherit_shop_blocks()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.resource_occupancies (tenant_id, barber_id, during, kind, block_id)
  select new.tenant_id, new.id, tb.during, 'block', tb.id
  from public.time_blocks tb
  where tb.tenant_id = new.tenant_id and tb.barber_id is null and upper(tb.during) > now();
  return new;
end $$;
create trigger barbers_inherit_blocks after insert on public.barbers
  for each row execute function private.barbers_inherit_shop_blocks();

-- Booking access token: HMAC(server key, tenant:idempotency_key). Deterministic,
-- so a retried request gets the same token back; only its SHA-256 is stored.
create or replace function private.booking_token(p_tenant_id uuid, p_idem uuid)
returns text language sql stable security definer set search_path = '' as $$
  select private.base64url(extensions.hmac(
    convert_to(p_tenant_id::text || ':' || p_idem::text, 'UTF8'),
    (select s.value from private.app_secrets s where s.name = 'booking_token_key'),
    'sha256'))
$$;

create or replace function private.policy_snapshot(p_tenant_id uuid, p_service_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'allow_self_cancel', coalesce(s.allow_self_cancel, t.allow_self_cancel),
    'cancel_min_notice_min', coalesce(s.cancel_min_notice_min, t.cancel_min_notice_min),
    'allow_self_reschedule', coalesce(s.allow_self_reschedule, t.allow_self_reschedule),
    'reschedule_min_notice_min', coalesce(s.reschedule_min_notice_min, t.reschedule_min_notice_min),
    'max_self_reschedules', t.max_self_reschedules)
  from public.tenants t join public.services s on s.tenant_id = t.id
  where t.id = p_tenant_id and s.id = p_service_id
$$;

-- What the client may do with a booking right now (uses the booking-time policy).
create or replace function private.client_policy(p_booking_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v record;
  v_cancel_deadline timestamptz;
  v_resched_deadline timestamptz;
  v_can_cancel boolean;
  v_can_resched boolean;
  v_cancel_reason text;
  v_resched_reason text;
begin
  select * into v from public.bookings where id = p_booking_id;
  v_cancel_deadline := v.starts_at - make_interval(mins => (v.snap_policy ->> 'cancel_min_notice_min')::int);
  v_resched_deadline := v.starts_at - make_interval(mins => (v.snap_policy ->> 'reschedule_min_notice_min')::int);

  v_cancel_reason := case
    when v.status <> 'confirmed' then 'not_active'
    when not (v.snap_policy ->> 'allow_self_cancel')::boolean then 'self_cancel_disabled'
    when now() > v_cancel_deadline then 'too_late'
    else null end;
  v_resched_reason := case
    when v.status <> 'confirmed' then 'not_active'
    when not (v.snap_policy ->> 'allow_self_reschedule')::boolean then 'self_reschedule_disabled'
    when now() > v_resched_deadline then 'too_late'
    when v.reschedule_count >= (v.snap_policy ->> 'max_self_reschedules')::int then 'reschedule_limit'
    else null end;
  v_can_cancel := v_cancel_reason is null;
  v_can_resched := v_resched_reason is null;
  return jsonb_build_object(
    'can_cancel', v_can_cancel, 'cancel_block_reason', v_cancel_reason, 'cancel_deadline', v_cancel_deadline,
    'can_reschedule', v_can_resched, 'reschedule_block_reason', v_resched_reason,
    'reschedule_deadline', v_resched_deadline);
end $$;

-- Outbox: (re)plan notification jobs after a booking state change.
-- Runs inside the same transaction as the change.
create or replace function private.enqueue_booking_notifications(
  p_booking_id uuid, p_event text, p_actor_kind text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_b record;
  v_t record;
  v_offset int;
  v_initial_status text;
  v_reason text;
begin
  select * into v_b from public.bookings where id = p_booking_id;
  select * into v_t from public.tenants where id = v_b.tenant_id;

  -- Supersede everything planned for older versions of this booking.
  update public.notification_jobs
     set status = 'cancelled', status_reason = 'superseded', completed_at = now()
   where booking_id = p_booking_id and status in ('pending', 'processing')
     and booking_version < v_b.version;

  if v_t.status <> 'live' or v_b.is_demo then
    v_initial_status := 'skipped';
    v_reason := case when v_b.is_demo then 'demo_booking' else 'tenant_' || v_t.status end;
  else
    v_initial_status := 'pending';
    v_reason := null;
  end if;

  -- Staff are told about client-side actions; customers about staff-side ones.
  if p_actor_kind in ('client', 'ai') and v_t.notify_staff then
    insert into public.notification_jobs (tenant_id, booking_id, booking_version, audience, event,
                                          dedupe_key, status, status_reason, completed_at)
    values (v_b.tenant_id, v_b.id, v_b.version, 'staff', p_event,
            format('b:%s:v%s:%s:staff', v_b.id, v_b.version, p_event),
            v_initial_status, v_reason, case when v_initial_status = 'skipped' then now() end)
    on conflict (dedupe_key) do nothing;
  end if;
  if p_actor_kind in ('staff', 'system') and p_event in ('rescheduled', 'cancelled') then
    insert into public.notification_jobs (tenant_id, booking_id, booking_version, audience, event,
                                          dedupe_key, status, status_reason, completed_at)
    values (v_b.tenant_id, v_b.id, v_b.version, 'customer', p_event,
            format('b:%s:v%s:%s:customer', v_b.id, v_b.version, p_event),
            v_initial_status, v_reason, case when v_initial_status = 'skipped' then now() end)
    on conflict (dedupe_key) do nothing;
  end if;

  if v_b.status = 'confirmed' then
    foreach v_offset in array v_t.reminder_offsets_min loop
      if v_b.starts_at - make_interval(mins => v_offset) > now() + interval '1 minute' then
        insert into public.notification_jobs (tenant_id, booking_id, booking_version, audience, event,
                                              dedupe_key, run_at, status, status_reason, completed_at)
        values (v_b.tenant_id, v_b.id, v_b.version, 'customer', 'reminder',
                format('b:%s:v%s:reminder:%s', v_b.id, v_b.version, v_offset),
                v_b.starts_at - make_interval(mins => v_offset),
                v_initial_status, v_reason, case when v_initial_status = 'skipped' then now() end)
        on conflict (dedupe_key) do nothing;
      end if;
    end loop;
  end if;
end $$;

-- Find or create the customer row for a tenant by normalized phone.
create or replace function private.upsert_customer(
  p_tenant_id uuid, p_name text, p_phone text, p_email text, p_is_demo boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_norm text := private.normalize_phone(p_phone);
  v_id uuid;
begin
  if v_norm is null then
    perform private.fail('invalid_phone');
  end if;
  insert into public.customers as c (tenant_id, name, phone, phone_normalized, email, is_demo)
  values (p_tenant_id, btrim(p_name), btrim(p_phone), v_norm, nullif(btrim(coalesce(p_email, '')), ''), p_is_demo)
  on conflict (tenant_id, phone_normalized) do update
    set email = coalesce(excluded.email, c.email)
  returning id into v_id;
  return v_id;
end $$;

-- Atomic booking creation. Tries the requested barber, or every eligible
-- barber for "any". The EXCLUDE constraint is the final arbiter under races.
create or replace function private.do_create_booking(
  p_tenant_id uuid, p_service_id uuid, p_barber_id uuid, p_start timestamptz,
  p_customer_id uuid, p_source text, p_actor uuid, p_check_hours boolean,
  p_idem uuid, p_request_hash text, p_is_demo boolean, p_internal_note text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_t record;
  v_s record;
  v_c record;
  v_cand record;
  v_reason text;
  v_last_reason text := 'no_eligible_barber';
  v_id uuid;
  v_local_date date;
begin
  select * into v_t from public.tenants where id = p_tenant_id;
  select * into v_s from public.services where id = p_service_id and tenant_id = p_tenant_id;
  if v_s.id is null then
    perform private.fail('service_not_found');
  end if;
  if not v_s.is_active then
    perform private.fail('service_inactive');
  end if;
  select * into v_c from public.customers where id = p_customer_id and tenant_id = p_tenant_id;
  if v_c.id is null then
    perform private.fail('customer_not_found');
  end if;
  if p_barber_id is not null and not exists (
       select 1 from public.barbers where id = p_barber_id and tenant_id = p_tenant_id) then
    perform private.fail('barber_not_found');
  end if;
  v_local_date := (p_start at time zone v_t.timezone)::date;

  for v_cand in
    select b.id, b.name
    from public.barbers b
    where b.tenant_id = p_tenant_id
      and (p_barber_id is null or b.id = p_barber_id)
    order by
      (select count(*) from public.bookings x
        where x.barber_id = b.id and x.status = 'confirmed'
          and (x.starts_at at time zone v_t.timezone)::date = v_local_date),
      b.sort_order, b.id
  loop
    v_reason := private.check_slot(v_cand.id, p_service_id, p_start, v_s.duration_min, v_s.buffer_min,
                                   p_check_hours, null);
    if v_reason is not null then
      v_last_reason := v_reason;
      continue;
    end if;
    begin
      insert into public.bookings (
        tenant_id, customer_id, barber_id, service_id, starts_at, ends_at, occupied_until,
        status, source, is_demo, snap_service_name, snap_duration_min, snap_buffer_min,
        snap_price_cents, snap_currency, snap_tenant_name, snap_timezone, snap_policy,
        snap_barber_name, snap_customer_name, snap_customer_phone, snap_customer_email,
        internal_note, idempotency_key, request_hash, token_hash, created_by)
      values (
        p_tenant_id, p_customer_id, v_cand.id, p_service_id, p_start,
        p_start + make_interval(mins => v_s.duration_min),
        p_start + make_interval(mins => v_s.duration_min + v_s.buffer_min),
        'confirmed', p_source, p_is_demo, v_s.name, v_s.duration_min, v_s.buffer_min,
        v_s.price_cents, v_t.currency, v_t.name, v_t.timezone,
        private.policy_snapshot(p_tenant_id, p_service_id),
        v_cand.name, v_c.name, v_c.phone, v_c.email,
        coalesce(p_internal_note, ''), p_idem, p_request_hash,
        case when p_idem is null then null
             else private.token_hash(private.booking_token(p_tenant_id, p_idem)) end,
        p_actor)
      returning id into v_id;

      insert into public.resource_occupancies (tenant_id, barber_id, during, kind, booking_id)
      values (p_tenant_id, v_cand.id,
              tstzrange(p_start, p_start + make_interval(mins => v_s.duration_min + v_s.buffer_min)),
              'booking', v_id);
    exception when exclusion_violation then
      v_last_reason := 'conflict';
      v_id := null;
      continue;
    end;

    insert into public.booking_events (tenant_id, booking_id, type, actor, data)
    values (p_tenant_id, v_id, 'created',
            case when p_source = 'owner' then 'staff:' || coalesce(p_actor::text, '') else p_source end,
            jsonb_build_object('starts_at', p_start, 'barber_id', v_cand.id, 'auto_assigned', p_barber_id is null));
    perform private.enqueue_booking_notifications(v_id, 'created',
      case when p_source = 'owner' then 'staff' when p_source = 'seed' then 'system' else p_source end);
    return v_id;
  end loop;

  perform private.fail('slot_unavailable', v_last_reason);
  return null;
end $$;

-- Atomic reschedule. On any failure the original booking and its occupancy
-- remain untouched (exception blocks roll back to the savepoint).
-- p_mode: 'same' (keep barber), 'any' (any eligible), 'barber' (p_barber_id).
create or replace function private.do_reschedule_booking(
  p_booking_id uuid, p_new_start timestamptz, p_mode text, p_barber_id uuid,
  p_check_hours boolean, p_actor_kind text, p_actor uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_b record;
  v_cand record;
  v_reason text;
  v_last_reason text := 'no_eligible_barber';
  v_done boolean := false;
  v_tz text;
begin
  select * into v_b from public.bookings where id = p_booking_id for update;
  if v_b.id is null then
    perform private.fail('booking_not_found');
  end if;
  if v_b.status <> 'confirmed' then
    perform private.fail('booking_not_active', v_b.status);
  end if;
  if p_mode not in ('same', 'any', 'barber') or (p_mode = 'barber' and p_barber_id is null) then
    perform private.fail('invalid_input', 'mode');
  end if;
  v_tz := v_b.snap_timezone;

  for v_cand in
    select b.id, b.name from public.barbers b
    where b.tenant_id = v_b.tenant_id
      and case p_mode when 'same' then b.id = v_b.barber_id
                      when 'barber' then b.id = p_barber_id
                      else true end
    order by (b.id <> v_b.barber_id),
      (select count(*) from public.bookings x
        where x.barber_id = b.id and x.status = 'confirmed'
          and (x.starts_at at time zone v_tz)::date = (p_new_start at time zone v_tz)::date),
      b.sort_order, b.id
  loop
    v_reason := private.check_slot(v_cand.id, v_b.service_id, p_new_start,
                                   v_b.snap_duration_min, v_b.snap_buffer_min, p_check_hours, v_b.id);
    if v_reason is not null then
      v_last_reason := v_reason;
      continue;
    end if;
    begin
      update public.resource_occupancies set active = false
       where booking_id = v_b.id and active;
      insert into public.resource_occupancies (tenant_id, barber_id, during, kind, booking_id)
      values (v_b.tenant_id, v_cand.id,
              tstzrange(p_new_start, p_new_start + make_interval(mins => v_b.snap_duration_min + v_b.snap_buffer_min)),
              'booking', v_b.id);
      update public.bookings
         set starts_at = p_new_start,
             ends_at = p_new_start + make_interval(mins => v_b.snap_duration_min),
             occupied_until = p_new_start + make_interval(mins => v_b.snap_duration_min + v_b.snap_buffer_min),
             barber_id = v_cand.id,
             snap_barber_name = v_cand.name,
             version = version + 1,
             reschedule_count = reschedule_count + case when p_actor_kind in ('client', 'ai') then 1 else 0 end
       where id = v_b.id;
      v_done := true;
    exception when exclusion_violation then
      v_last_reason := 'conflict';
      continue;
    end;
    exit when v_done;
  end loop;

  if not v_done then
    perform private.fail('slot_unavailable', v_last_reason);
  end if;

  insert into public.booking_events (tenant_id, booking_id, type, actor, data)
  values (v_b.tenant_id, v_b.id, 'rescheduled',
          case when p_actor_kind = 'staff' then 'staff:' || coalesce(p_actor::text, '') else p_actor_kind end,
          jsonb_build_object('from', v_b.starts_at, 'to', p_new_start,
                             'from_barber_id', v_b.barber_id,
                             'to_barber_id', (select barber_id from public.bookings where id = v_b.id)));
  perform private.enqueue_booking_notifications(v_b.id, 'rescheduled', p_actor_kind);
end $$;

create or replace function private.do_cancel_booking(
  p_booking_id uuid, p_actor_kind text, p_actor uuid, p_reason text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_b record;
begin
  select * into v_b from public.bookings where id = p_booking_id for update;
  if v_b.id is null then
    perform private.fail('booking_not_found');
  end if;
  if v_b.status = 'cancelled' then
    return false; -- idempotent
  end if;
  if v_b.status <> 'confirmed' then
    perform private.fail('booking_not_active', v_b.status);
  end if;
  update public.resource_occupancies set active = false where booking_id = v_b.id and active;
  update public.bookings
     set status = 'cancelled', cancelled_at = now(),
         cancelled_by = case when p_actor_kind in ('client', 'ai') then 'client'
                             when p_actor_kind = 'staff' then 'staff' else 'system' end,
         cancel_reason = nullif(btrim(coalesce(p_reason, '')), ''),
         version = version + 1
   where id = v_b.id;
  insert into public.booking_events (tenant_id, booking_id, type, actor, data)
  values (v_b.tenant_id, v_b.id, 'cancelled',
          case when p_actor_kind = 'staff' then 'staff:' || coalesce(p_actor::text, '') else p_actor_kind end,
          jsonb_build_object('reason', p_reason));
  perform private.enqueue_booking_notifications(v_b.id, 'cancelled', p_actor_kind);
  return true;
end $$;
