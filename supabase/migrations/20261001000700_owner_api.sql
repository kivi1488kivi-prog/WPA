-- Owner cabinet API. Membership is verified on the server for every call;
-- roles: owner (everything), admin (operations, no tenant settings/go-live),
-- barber (own calendar, own bookings and blocks, own stats).

create or replace function private.require_member(p_tenant_id uuid, p_roles text[])
returns public.memberships language plpgsql stable security definer set search_path = '' as $$
declare v public.memberships;
begin
  if auth.uid() is null then
    perform private.fail('not_authenticated');
  end if;
  select * into v from public.memberships m where m.tenant_id = p_tenant_id and m.user_id = auth.uid();
  if v.user_id is null or not (v.role = any(p_roles)) then
    perform private.fail('forbidden');
  end if;
  return v;
end $$;

create or replace function private.has_role(p_tenant_id uuid, p_roles text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m
                 where m.tenant_id = p_tenant_id and m.user_id = auth.uid() and m.role = any(p_roles))
$$;

create or replace function private.my_barber_id(p_tenant_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select m.barber_id from public.memberships m
  where m.tenant_id = p_tenant_id and m.user_id = auth.uid() and m.role = 'barber'
$$;

-- Booking guard for barber role: may only touch own bookings.
create or replace function private.require_booking_access(p_tenant_id uuid, p_booking_id uuid, p_roles text[])
returns public.bookings language plpgsql stable security definer set search_path = '' as $$
declare
  m public.memberships;
  b public.bookings;
begin
  m := private.require_member(p_tenant_id, p_roles);
  select * into b from public.bookings where id = p_booking_id and tenant_id = p_tenant_id;
  if b.id is null then
    perform private.fail('booking_not_found');
  end if;
  if m.role = 'barber' and b.barber_id <> m.barber_id then
    perform private.fail('forbidden');
  end if;
  return b;
end $$;

create or replace function public.owner_my_tenants()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    perform private.fail('not_authenticated');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'tenant_id', t.id, 'slug', t.slug, 'name', t.name, 'status', t.status,
      'role', m.role, 'barber_id', m.barber_id, 'timezone', t.timezone,
      'currency', t.currency, 'locale', t.locale, 'accent_color', t.accent_color) order by t.name)
    from public.memberships m join public.tenants t on t.id = m.tenant_id
    where m.user_id = auth.uid()), '[]'::jsonb);
end $$;

-- Everything the cabinet needs to render configuration screens.
create or replace function public.owner_workspace(p_tenant_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  m public.memberships;
  t public.tenants;
begin
  m := private.require_member(p_tenant_id, array['owner', 'admin', 'barber']);
  select * into t from public.tenants where id = p_tenant_id;
  return jsonb_build_object(
    'role', m.role, 'my_barber_id', m.barber_id,
    'today', private.local_today(t.timezone),
    'tenant', to_jsonb(t) - 'config_hash',
    'opening_hours', coalesce((select jsonb_agg(to_jsonb(h) order by h.weekday, h.start_min)
                               from public.opening_hours h where h.tenant_id = t.id), '[]'::jsonb),
    'services', coalesce((select jsonb_agg(to_jsonb(s) || jsonb_build_object(
                             'barber_ids', coalesce((select jsonb_agg(bs.barber_id) from public.barber_services bs
                                                     where bs.service_id = s.id), '[]'::jsonb))
                           order by s.sort_order, s.name)
                          from public.services s where s.tenant_id = t.id), '[]'::jsonb),
    'barbers', coalesce((select jsonb_agg(to_jsonb(b) || jsonb_build_object(
                            'service_ids', coalesce((select jsonb_agg(bs.service_id) from public.barber_services bs
                                                     where bs.barber_id = b.id), '[]'::jsonb),
                            'weekly_hours', coalesce((select jsonb_agg(jsonb_build_object(
                                 'weekday', h.weekday, 'start_min', h.start_min, 'end_min', h.end_min)
                                 order by h.weekday, h.start_min)
                               from public.barber_weekly_hours h where h.barber_id = b.id), '[]'::jsonb),
                            'weekly_breaks', coalesce((select jsonb_agg(jsonb_build_object(
                                 'weekday', k.weekday, 'start_min', k.start_min, 'end_min', k.end_min, 'label', k.label)
                                 order by k.weekday, k.start_min)
                               from public.barber_weekly_breaks k where k.barber_id = b.id), '[]'::jsonb))
                          order by b.sort_order, b.name)
                         from public.barbers b where b.tenant_id = t.id), '[]'::jsonb),
    'overrides', coalesce((select jsonb_agg(to_jsonb(o) order by o.on_date, o.start_min)
                           from public.schedule_overrides o
                           where o.tenant_id = t.id and o.on_date >= private.local_today(t.timezone) - 7), '[]'::jsonb),
    'blocks', coalesce((select jsonb_agg(to_jsonb(tb) || jsonb_build_object(
                           'starts_at', lower(tb.during), 'ends_at', upper(tb.during)) order by lower(tb.during))
                        from public.time_blocks tb
                        where tb.tenant_id = t.id and upper(tb.during) > now() - interval '7 days'
                          and (m.role <> 'barber' or tb.barber_id is null or tb.barber_id = m.barber_id)), '[]'::jsonb),
    'photos', coalesce((select jsonb_agg(to_jsonb(p) order by p.kind, p.sort_order)
                        from public.tenant_photos p where p.tenant_id = t.id), '[]'::jsonb),
    'members', case when m.role = 'owner' then coalesce((
                 select jsonb_agg(jsonb_build_object('user_id', mm.user_id, 'email', u.email,
                                                     'role', mm.role, 'barber_id', mm.barber_id) order by mm.role)
                 from public.memberships mm join auth.users u on u.id = mm.user_id
                 where mm.tenant_id = t.id), '[]'::jsonb) else '[]'::jsonb end
  );
end $$;

-- Calendar -----------------------------------------------------------------------
create or replace function public.owner_calendar(
  p_tenant_id uuid, p_from date, p_to date, p_barber_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  m public.memberships;
  t public.tenants;
  v_barber uuid := p_barber_id;
  v_from_ts timestamptz;
  v_to_ts timestamptz;
begin
  m := private.require_member(p_tenant_id, array['owner', 'admin', 'barber']);
  if p_to < p_from or p_to - p_from > 41 then
    perform private.fail('invalid_input', 'range');
  end if;
  if m.role = 'barber' then
    v_barber := m.barber_id;
  end if;
  select * into t from public.tenants where id = p_tenant_id;
  v_from_ts := private.local_ts(p_from, 0, t.timezone);
  v_to_ts := private.local_ts(p_to + 1, 0, t.timezone);

  return jsonb_build_object(
    'timezone', t.timezone, 'from', p_from, 'to', p_to, 'now', now(),
    'barbers', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'color', b.color,
                                                             'marker', b.marker, 'is_active', b.is_active,
                                                             'photo_path', b.photo_path)
                                          order by b.sort_order, b.name)
                         from public.barbers b
                         where b.tenant_id = t.id and (v_barber is null or b.id = v_barber)
                           and (b.is_active or exists (select 1 from public.bookings x where x.barber_id = b.id
                                                        and x.starts_at < v_to_ts and x.ends_at > v_from_ts))), '[]'::jsonb),
    'bookings', coalesce((select jsonb_agg(jsonb_build_object(
                             'id', bk.id, 'status', bk.status, 'starts_at', bk.starts_at, 'ends_at', bk.ends_at,
                             'occupied_until', bk.occupied_until, 'barber_id', bk.barber_id,
                             'barber_name', bk.snap_barber_name, 'service_id', bk.service_id,
                             'service_name', bk.snap_service_name, 'duration_min', bk.snap_duration_min,
                             'price_cents', bk.snap_price_cents, 'currency', bk.snap_currency,
                             'customer_id', bk.customer_id, 'customer_name', bk.snap_customer_name,
                             'customer_phone', bk.snap_customer_phone, 'source', bk.source,
                             'is_demo', bk.is_demo, 'internal_note', bk.internal_note,
                             'cancel_reason', bk.cancel_reason, 'cancelled_by', bk.cancelled_by,
                             'paid_cents', coalesce((select sum(case when p.kind = 'payment' then p.amount_cents else -p.amount_cents end)
                                                     from public.payments p where p.booking_id = bk.id), 0))
                           order by bk.starts_at)
                          from public.bookings bk
                          where bk.tenant_id = t.id and bk.starts_at < v_to_ts and bk.ends_at > v_from_ts
                            and (v_barber is null or bk.barber_id = v_barber)), '[]'::jsonb),
    'blocks', coalesce((select jsonb_agg(jsonb_build_object(
                           'id', tb.id, 'barber_id', tb.barber_id, 'kind', tb.kind, 'note', tb.note,
                           'starts_at', lower(tb.during), 'ends_at', upper(tb.during)) order by lower(tb.during))
                        from public.time_blocks tb
                        where tb.tenant_id = t.id and tb.during && tstzrange(v_from_ts, v_to_ts)
                          and (v_barber is null or tb.barber_id is null or tb.barber_id = v_barber)), '[]'::jsonb),
    'days', coalesce((
      select jsonb_agg(jsonb_build_object(
               'date', d.d::date, 'barber_id', b.id,
               'work', (select coalesce(jsonb_agg(jsonb_build_object('start', lower(r), 'end', upper(r)) order by lower(r)), '[]'::jsonb)
                        from unnest(private.barber_work_ranges(b.id, d.d::date)) r),
               'breaks', (select coalesce(jsonb_agg(jsonb_build_object('start', lower(r), 'end', upper(r)) order by lower(r)), '[]'::jsonb)
                          from unnest(private.barber_break_ranges(b.id, d.d::date)) r),
               'free', (select coalesce(jsonb_agg(jsonb_build_object('start', lower(r), 'end', upper(r)) order by lower(r)), '[]'::jsonb)
                        from unnest(private.barber_work_ranges(b.id, d.d::date) - coalesce((
                               select range_agg(o.during) from public.resource_occupancies o
                               where o.barber_id = b.id and o.active
                                 and o.during && tstzrange(v_from_ts - interval '1 day', v_to_ts + interval '1 day')),
                               '{}'::tstzmultirange)) r))
             order by d.d, b.sort_order)
      from generate_series(p_from, p_to, interval '1 day') d(d)
      cross join public.barbers b
      where b.tenant_id = t.id and b.is_active and (v_barber is null or b.id = v_barber)), '[]'::jsonb)
  );
end $$;

-- Bookings -------------------------------------------------------------------------
create or replace function public.owner_create_booking(
  p_tenant_id uuid, p_service_id uuid, p_barber_id uuid, p_starts_at timestamptz,
  p_customer jsonb, p_note text default '', p_ignore_hours boolean default false,
  p_idempotency_key uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  m public.memberships;
  t public.tenants;
  v_barber uuid := p_barber_id;
  v_customer uuid;
  v_existing public.bookings;
  v_hash text;
  v_id uuid;
begin
  m := private.require_member(p_tenant_id, array['owner', 'admin', 'barber']);
  if p_idempotency_key is null then
    perform private.fail('invalid_input', 'idempotency_key');
  end if;
  if m.role = 'barber' then
    if v_barber is not null and v_barber <> m.barber_id then
      perform private.fail('forbidden');
    end if;
    v_barber := m.barber_id;
    if p_ignore_hours then
      perform private.fail('forbidden', 'ignore_hours');
    end if;
  end if;
  select * into t from public.tenants where id = p_tenant_id;
  perform pg_advisory_xact_lock(hashtextextended(t.id::text || ':' || p_idempotency_key::text, 0));
  v_hash := private.sha256_hex(jsonb_build_object('service', p_service_id, 'barber', v_barber,
                                                  'start', p_starts_at, 'customer', p_customer)::text);
  select * into v_existing from public.bookings where tenant_id = t.id and idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    if v_existing.request_hash is distinct from v_hash then
      perform private.fail('idempotency_mismatch');
    end if;
    return jsonb_build_object('booking_id', v_existing.id, 'replayed', true);
  end if;

  if p_customer ? 'id' and nullif(p_customer ->> 'id', '') is not null then
    select id into v_customer from public.customers
     where id = (p_customer ->> 'id')::uuid and tenant_id = t.id;
    if v_customer is null then
      perform private.fail('customer_not_found');
    end if;
  else
    if length(btrim(coalesce(p_customer ->> 'name', ''))) = 0 then
      perform private.fail('invalid_name');
    end if;
    v_customer := private.upsert_customer(t.id, p_customer ->> 'name', p_customer ->> 'phone',
                                          lower(nullif(btrim(coalesce(p_customer ->> 'email', '')), '')),
                                          t.status = 'preview');
  end if;

  v_id := private.do_create_booking(t.id, p_service_id, v_barber, p_starts_at, v_customer,
                                    'owner', auth.uid(), not coalesce(p_ignore_hours, false),
                                    p_idempotency_key, v_hash, t.status = 'preview', coalesce(p_note, ''));
  return jsonb_build_object('booking_id', v_id, 'replayed', false);
end $$;

create or replace function public.owner_reschedule_booking(
  p_tenant_id uuid, p_booking_id uuid, p_new_starts_at timestamptz,
  p_barber_id uuid default null, p_ignore_hours boolean default false,
  p_idempotency_key uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  m public.memberships;
  b public.bookings;
  v_hash text;
  v_prev record;
  v_mode text;
begin
  b := private.require_booking_access(p_tenant_id, p_booking_id, array['owner', 'admin', 'barber']);
  m := private.require_member(p_tenant_id, array['owner', 'admin', 'barber']);
  if p_idempotency_key is null then
    perform private.fail('invalid_input', 'idempotency_key');
  end if;
  if m.role = 'barber' and ((p_barber_id is not null and p_barber_id <> m.barber_id) or p_ignore_hours) then
    perform private.fail('forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(b.id::text || ':reschedule:' || p_idempotency_key::text, 0));
  v_hash := private.sha256_hex(jsonb_build_object('booking', b.id, 'start', p_new_starts_at,
                                                  'barber', p_barber_id, 'ignore', p_ignore_hours)::text);
  select * into v_prev from public.idempotency_records
   where tenant_id = b.tenant_id and scope = 'reschedule:' || b.id and key = p_idempotency_key;
  if v_prev.key is not null then
    if v_prev.request_hash <> v_hash then
      perform private.fail('idempotency_mismatch');
    end if;
    return jsonb_build_object('booking_id', b.id, 'replayed', true);
  end if;
  v_mode := case when p_barber_id is null or p_barber_id = b.barber_id then 'same' else 'barber' end;
  perform private.do_reschedule_booking(b.id, p_new_starts_at, v_mode, p_barber_id,
                                        not coalesce(p_ignore_hours, false), 'staff', auth.uid());
  insert into public.idempotency_records (tenant_id, scope, key, request_hash, result)
  values (b.tenant_id, 'reschedule:' || b.id, p_idempotency_key, v_hash, jsonb_build_object('booking_id', b.id));
  return jsonb_build_object('booking_id', b.id, 'replayed', false);
end $$;

create or replace function public.owner_cancel_booking(p_tenant_id uuid, p_booking_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.bookings; v_changed boolean;
begin
  b := private.require_booking_access(p_tenant_id, p_booking_id, array['owner', 'admin', 'barber']);
  v_changed := private.do_cancel_booking(b.id, 'staff', auth.uid(), p_reason);
  return jsonb_build_object('booking_id', b.id, 'changed', v_changed);
end $$;

create or replace function public.owner_set_booking_status(p_tenant_id uuid, p_booking_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  m public.memberships;
begin
  b := private.require_booking_access(p_tenant_id, p_booking_id, array['owner', 'admin', 'barber']);
  m := private.require_member(p_tenant_id, array['owner', 'admin', 'barber']);
  if p_status not in ('completed', 'no_show', 'confirmed') then
    perform private.fail('invalid_input', 'status');
  end if;
  if b.status = 'cancelled' then
    perform private.fail('booking_not_active', 'cancelled');
  end if;
  if p_status = 'confirmed' and m.role = 'barber' then
    perform private.fail('forbidden');
  end if;
  if p_status in ('completed', 'no_show') and b.starts_at > now() then
    perform private.fail('invalid_transition', 'future_booking');
  end if;
  if b.status = p_status then
    return jsonb_build_object('booking_id', b.id, 'changed', false);
  end if;
  update public.bookings
     set status = p_status,
         completed_at = case when p_status = 'completed' then now() else null end
   where id = b.id;
  -- completed / no-show visits keep their occupancy (the time was really used).
  insert into public.booking_events (tenant_id, booking_id, type, actor, data)
  values (b.tenant_id, b.id, case when p_status = 'confirmed' then 'note' else p_status end,
          'staff:' || auth.uid(), jsonb_build_object('status', p_status, 'previous', b.status));
  return jsonb_build_object('booking_id', b.id, 'changed', true);
end $$;

create or replace function public.owner_update_booking_note(p_tenant_id uuid, p_booking_id uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare b public.bookings;
begin
  b := private.require_booking_access(p_tenant_id, p_booking_id, array['owner', 'admin', 'barber']);
  update public.bookings set internal_note = left(coalesce(p_note, ''), 2000) where id = b.id;
end $$;

-- Client access link for a booking (token recomputed, never stored).
create or replace function public.owner_booking_access_token(p_tenant_id uuid, p_booking_id uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare b public.bookings;
begin
  b := private.require_booking_access(p_tenant_id, p_booking_id, array['owner', 'admin', 'barber']);
  if b.idempotency_key is null then
    return null;
  end if;
  return private.booking_token(b.tenant_id, b.idempotency_key);
end $$;

-- Payments --------------------------------------------------------------------------
create or replace function public.owner_record_payment(
  p_tenant_id uuid, p_booking_id uuid, p_amount_cents int, p_method text,
  p_kind text default 'payment', p_note text default '', p_idempotency_key uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  v_paid bigint;
  v_id uuid;
begin
  b := private.require_booking_access(p_tenant_id, p_booking_id, array['owner', 'admin']);
  if p_idempotency_key is null then
    perform private.fail('invalid_input', 'idempotency_key');
  end if;
  select id into v_id from public.payments where tenant_id = b.tenant_id and idempotency_key = p_idempotency_key;
  if v_id is not null then
    return jsonb_build_object('payment_id', v_id, 'replayed', true);
  end if;
  if p_kind not in ('payment', 'refund') or coalesce(p_amount_cents, 0) <= 0 then
    perform private.fail('invalid_input', 'amount');
  end if;
  if b.status = 'cancelled' and p_kind = 'payment' then
    perform private.fail('booking_not_active', 'cancelled');
  end if;
  perform 1 from public.bookings where id = b.id for update;
  select coalesce(sum(case when kind = 'payment' then amount_cents else -amount_cents end), 0)
    into v_paid from public.payments where booking_id = b.id;
  if p_kind = 'refund' and p_amount_cents > v_paid then
    perform private.fail('invalid_input', 'refund_exceeds_paid');
  end if;
  insert into public.payments (tenant_id, booking_id, kind, amount_cents, currency, method, note,
                               recorded_by, idempotency_key)
  values (b.tenant_id, b.id, p_kind, p_amount_cents, b.snap_currency, p_method, left(coalesce(p_note, ''), 300),
          auth.uid(), p_idempotency_key)
  returning id into v_id;
  return jsonb_build_object('payment_id', v_id, 'replayed', false);
end $$;

create or replace function public.owner_booking_details(p_tenant_id uuid, p_booking_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  b public.bookings;
  m public.memberships;
begin
  b := private.require_booking_access(p_tenant_id, p_booking_id, array['owner', 'admin', 'barber']);
  m := private.require_member(p_tenant_id, array['owner', 'admin', 'barber']);
  return jsonb_build_object(
    'booking', to_jsonb(b) - 'token_hash' - 'request_hash' - 'idempotency_key',
    'events', coalesce((select jsonb_agg(jsonb_build_object('at', e.at, 'type', e.type, 'actor', e.actor, 'data', e.data)
                                         order by e.at)
                        from public.booking_events e where e.booking_id = b.id), '[]'::jsonb),
    'payments', case when m.role in ('owner', 'admin') then coalesce((
                  select jsonb_agg(jsonb_build_object('id', p.id, 'kind', p.kind, 'amount_cents', p.amount_cents,
                                                      'currency', p.currency, 'method', p.method,
                                                      'paid_at', p.paid_at, 'note', p.note) order by p.paid_at)
                  from public.payments p where p.booking_id = b.id), '[]'::jsonb) else '[]'::jsonb end,
    'notifications', coalesce((select jsonb_agg(jsonb_build_object('audience', j.audience, 'event', j.event,
                                                                   'status', j.status, 'status_reason', j.status_reason,
                                                                   'run_at', j.run_at) order by j.run_at)
                               from public.notification_jobs j where j.booking_id = b.id), '[]'::jsonb),
    'has_customer_push', exists (select 1 from public.push_subscriptions ps
                                 where ps.booking_id = b.id and ps.disabled_at is null));
end $$;

-- Barbers ------------------------------------------------------------------------------
create or replace function public.owner_upsert_barber(p_tenant_id uuid, p_barber jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := nullif(p_barber ->> 'id', '')::uuid;
  v_specs text[];
begin
  perform private.require_member(p_tenant_id, array['owner', 'admin']);
  v_specs := coalesce((select array_agg(left(btrim(x), 40)) from jsonb_array_elements_text(
                         coalesce(p_barber -> 'specialties', '[]'::jsonb)) x where btrim(x) <> ''), '{}');
  if p_barber ? 'photo_path' and nullif(p_barber ->> 'photo_path', '') is not null
     and not (p_barber ->> 'photo_path') like p_tenant_id::text || '/%' then
    perform private.fail('invalid_input', 'photo_path');
  end if;
  if v_id is null then
    insert into public.barbers (tenant_id, managed_by, name, title, bio, photo_path, photo_source,
                                specialties, color, marker, is_active, sort_order)
    values (p_tenant_id, 'owner', btrim(p_barber ->> 'name'), p_barber ->> 'title', p_barber ->> 'bio',
            nullif(p_barber ->> 'photo_path', ''),
            case when nullif(p_barber ->> 'photo_path', '') is not null then 'owner' end,
            v_specs, coalesce(p_barber ->> 'color', '#9CA3AF'), coalesce(p_barber ->> 'marker', ''),
            coalesce((p_barber ->> 'is_active')::boolean, true), coalesce((p_barber ->> 'sort_order')::int, 0))
    returning id into v_id;
  else
    update public.barbers set
      managed_by = 'owner',
      name = coalesce(btrim(p_barber ->> 'name'), name),
      title = case when p_barber ? 'title' then p_barber ->> 'title' else title end,
      bio = case when p_barber ? 'bio' then p_barber ->> 'bio' else bio end,
      photo_path = case when p_barber ? 'photo_path' then nullif(p_barber ->> 'photo_path', '') else photo_path end,
      photo_source = case when p_barber ? 'photo_path' then 'owner' else photo_source end,
      specialties = case when p_barber ? 'specialties' then v_specs else specialties end,
      color = coalesce(p_barber ->> 'color', color),
      marker = coalesce(p_barber ->> 'marker', marker),
      is_active = coalesce((p_barber ->> 'is_active')::boolean, is_active),
      sort_order = coalesce((p_barber ->> 'sort_order')::int, sort_order)
    where id = v_id and tenant_id = p_tenant_id;
    if not found then
      perform private.fail('barber_not_found');
    end if;
  end if;
  return v_id;
end $$;

create or replace function public.owner_set_barber_services(p_tenant_id uuid, p_barber_id uuid, p_service_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_member(p_tenant_id, array['owner', 'admin']);
  if not exists (select 1 from public.barbers where id = p_barber_id and tenant_id = p_tenant_id) then
    perform private.fail('barber_not_found');
  end if;
  if exists (select 1 from unnest(coalesce(p_service_ids, '{}')) sid
             where not exists (select 1 from public.services s where s.id = sid and s.tenant_id = p_tenant_id)) then
    perform private.fail('service_not_found');
  end if;
  delete from public.barber_services where barber_id = p_barber_id
    and not (service_id = any(coalesce(p_service_ids, '{}')));
  insert into public.barber_services (tenant_id, barber_id, service_id)
  select p_tenant_id, p_barber_id, sid from unnest(coalesce(p_service_ids, '{}')) sid
  on conflict do nothing;
  update public.barbers set managed_by = 'owner' where id = p_barber_id;
end $$;

create or replace function public.owner_set_barber_schedule(
  p_tenant_id uuid, p_barber_id uuid, p_hours jsonb, p_breaks jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_member(p_tenant_id, array['owner', 'admin']);
  if not exists (select 1 from public.barbers where id = p_barber_id and tenant_id = p_tenant_id) then
    perform private.fail('barber_not_found');
  end if;
  delete from public.barber_weekly_hours where barber_id = p_barber_id;
  delete from public.barber_weekly_breaks where barber_id = p_barber_id;
  begin
    insert into public.barber_weekly_hours (tenant_id, barber_id, weekday, start_min, end_min)
    select p_tenant_id, p_barber_id, (x ->> 'weekday')::int, (x ->> 'start_min')::int, (x ->> 'end_min')::int
    from jsonb_array_elements(coalesce(p_hours, '[]'::jsonb)) x;
    insert into public.barber_weekly_breaks (tenant_id, barber_id, weekday, start_min, end_min, label)
    select p_tenant_id, p_barber_id, (x ->> 'weekday')::int, (x ->> 'start_min')::int, (x ->> 'end_min')::int,
           coalesce(x ->> 'label', '')
    from jsonb_array_elements(coalesce(p_breaks, '[]'::jsonb)) x;
  exception
    when exclusion_violation then perform private.fail('schedule_overlap');
    when check_violation then perform private.fail('invalid_input', 'schedule');
  end;
  update public.barbers set managed_by = 'owner' where id = p_barber_id;
end $$;

-- Replace all overrides of (barber|shop, date). Empty/NULL intervals = closed.
create or replace function public.owner_set_override(
  p_tenant_id uuid, p_barber_id uuid, p_date date, p_intervals jsonb, p_note text default '')
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_member(p_tenant_id, array['owner', 'admin']);
  if p_barber_id is not null and not exists (select 1 from public.barbers where id = p_barber_id and tenant_id = p_tenant_id) then
    perform private.fail('barber_not_found');
  end if;
  delete from public.schedule_overrides
   where tenant_id = p_tenant_id and on_date = p_date and barber_id is not distinct from p_barber_id;
  begin
    if p_intervals is null or jsonb_array_length(p_intervals) = 0 then
      insert into public.schedule_overrides (tenant_id, barber_id, on_date, note)
      values (p_tenant_id, p_barber_id, p_date, left(coalesce(p_note, ''), 200));
    else
      insert into public.schedule_overrides (tenant_id, barber_id, on_date, start_min, end_min, note)
      select p_tenant_id, p_barber_id, p_date, (x ->> 'start_min')::int, (x ->> 'end_min')::int,
             left(coalesce(p_note, ''), 200)
      from jsonb_array_elements(p_intervals) x;
    end if;
  exception
    when exclusion_violation then perform private.fail('schedule_overlap');
    when check_violation then perform private.fail('invalid_input', 'override');
  end;
end $$;

create or replace function public.owner_delete_override(p_tenant_id uuid, p_barber_id uuid, p_date date)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_member(p_tenant_id, array['owner', 'admin']);
  delete from public.schedule_overrides
   where tenant_id = p_tenant_id and on_date = p_date and barber_id is not distinct from p_barber_id;
end $$;

-- Blocks ----------------------------------------------------------------------------------
create or replace function public.owner_create_block(
  p_tenant_id uuid, p_barber_id uuid, p_starts_at timestamptz, p_ends_at timestamptz,
  p_kind text, p_note text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  m public.memberships;
  v_id uuid;
  v_range tstzrange;
  v_conflicts jsonb;
begin
  m := private.require_member(p_tenant_id, array['owner', 'admin', 'barber']);
  if m.role = 'barber' and (p_barber_id is null or p_barber_id <> m.barber_id) then
    perform private.fail('forbidden');
  end if;
  if p_barber_id is not null and not exists (select 1 from public.barbers where id = p_barber_id and tenant_id = p_tenant_id) then
    perform private.fail('barber_not_found');
  end if;
  if p_ends_at <= p_starts_at then
    perform private.fail('invalid_input', 'range');
  end if;
  v_range := tstzrange(p_starts_at, p_ends_at, '[)');
  -- Serialize with concurrent bookings of the affected barbers.
  perform 1 from public.barbers where tenant_id = p_tenant_id and (p_barber_id is null or id = p_barber_id)
    order by id for update;
  v_conflicts := private.block_conflicts(p_tenant_id, p_barber_id, v_range);
  if jsonb_array_length(v_conflicts) > 0 then
    perform private.fail('block_conflict', v_conflicts::text);
  end if;
  insert into public.time_blocks (tenant_id, barber_id, during, kind, note, created_by)
  values (p_tenant_id, p_barber_id, v_range, p_kind, left(coalesce(p_note, ''), 200), auth.uid())
  returning id into v_id;
  begin
    perform private.materialize_block(v_id);
  exception when exclusion_violation then
    perform private.fail('block_conflict', private.block_conflicts(p_tenant_id, p_barber_id, v_range)::text);
  end;
  return jsonb_build_object('block_id', v_id);
end $$;

create or replace function public.owner_delete_block(p_tenant_id uuid, p_block_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m public.memberships;
  v record;
begin
  m := private.require_member(p_tenant_id, array['owner', 'admin', 'barber']);
  select * into v from public.time_blocks where id = p_block_id and tenant_id = p_tenant_id;
  if v.id is null then
    perform private.fail('block_not_found');
  end if;
  if m.role = 'barber' and (v.barber_id is null or v.barber_id <> m.barber_id) then
    perform private.fail('forbidden');
  end if;
  delete from public.time_blocks where id = p_block_id;
end $$;

-- Services ------------------------------------------------------------------------------
create or replace function public.owner_upsert_service(p_tenant_id uuid, p_service jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid := nullif(p_service ->> 'id', '')::uuid;
begin
  perform private.require_member(p_tenant_id, array['owner', 'admin']);
  begin
    if v_id is null then
      insert into public.services (tenant_id, managed_by, name, description, duration_min, buffer_min,
                                   price_cents, is_active, sort_order, allow_self_cancel,
                                   cancel_min_notice_min, allow_self_reschedule, reschedule_min_notice_min)
      values (p_tenant_id, 'owner', btrim(p_service ->> 'name'), p_service ->> 'description',
              (p_service ->> 'duration_min')::int, coalesce((p_service ->> 'buffer_min')::int, 0),
              (p_service ->> 'price_cents')::int, coalesce((p_service ->> 'is_active')::boolean, true),
              coalesce((p_service ->> 'sort_order')::int, 0),
              (p_service ->> 'allow_self_cancel')::boolean, (p_service ->> 'cancel_min_notice_min')::int,
              (p_service ->> 'allow_self_reschedule')::boolean, (p_service ->> 'reschedule_min_notice_min')::int)
      returning id into v_id;
    else
      update public.services set
        managed_by = 'owner',
        name = coalesce(btrim(p_service ->> 'name'), name),
        description = case when p_service ? 'description' then p_service ->> 'description' else description end,
        duration_min = coalesce((p_service ->> 'duration_min')::int, duration_min),
        buffer_min = coalesce((p_service ->> 'buffer_min')::int, buffer_min),
        price_cents = coalesce((p_service ->> 'price_cents')::int, price_cents),
        is_active = coalesce((p_service ->> 'is_active')::boolean, is_active),
        sort_order = coalesce((p_service ->> 'sort_order')::int, sort_order),
        allow_self_cancel = case when p_service ? 'allow_self_cancel' then (p_service ->> 'allow_self_cancel')::boolean else allow_self_cancel end,
        cancel_min_notice_min = case when p_service ? 'cancel_min_notice_min' then (p_service ->> 'cancel_min_notice_min')::int else cancel_min_notice_min end,
        allow_self_reschedule = case when p_service ? 'allow_self_reschedule' then (p_service ->> 'allow_self_reschedule')::boolean else allow_self_reschedule end,
        reschedule_min_notice_min = case when p_service ? 'reschedule_min_notice_min' then (p_service ->> 'reschedule_min_notice_min')::int else reschedule_min_notice_min end
      where id = v_id and tenant_id = p_tenant_id;
      if not found then
        perform private.fail('service_not_found');
      end if;
    end if;
  exception
    when check_violation or not_null_violation then perform private.fail('invalid_input', 'service');
  end;
  return v_id;
end $$;

-- Customers -------------------------------------------------------------------------------
create or replace function public.owner_list_customers(p_tenant_id uuid, p_search text default '', p_limit int default 50)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  m public.memberships;
  v_q text := btrim(coalesce(p_search, ''));
begin
  m := private.require_member(p_tenant_id, array['owner', 'admin', 'barber']);
  return coalesce((
    select jsonb_agg(x order by x ->> 'name')
    from (
      select jsonb_build_object(
        'id', c.id, 'name', c.name, 'phone', c.phone, 'email', c.email, 'is_demo', c.is_demo,
        'visits', (select count(*) from public.bookings b where b.customer_id = c.id and b.status = 'completed'),
        'no_shows', (select count(*) from public.bookings b where b.customer_id = c.id and b.status = 'no_show'),
        'last_visit', (select max(b.starts_at) from public.bookings b where b.customer_id = c.id and b.status = 'completed'),
        'next_visit', (select min(b.starts_at) from public.bookings b where b.customer_id = c.id
                         and b.status = 'confirmed' and b.starts_at > now())) as x
      from public.customers c
      where c.tenant_id = p_tenant_id
        and (v_q = '' or c.name ilike '%' || v_q || '%' or c.phone_normalized like '%' || regexp_replace(v_q, '[^0-9]', '', 'g') || '%'
             and regexp_replace(v_q, '[^0-9]', '', 'g') <> '' or c.email ilike '%' || v_q || '%')
        and (m.role <> 'barber' or exists (select 1 from public.bookings b where b.customer_id = c.id and b.barber_id = m.barber_id))
      order by c.name
      limit least(greatest(coalesce(p_limit, 50), 1), 200)) s), '[]'::jsonb);
end $$;

create or replace function public.owner_get_customer(p_tenant_id uuid, p_customer_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  m public.memberships;
  c public.customers;
begin
  m := private.require_member(p_tenant_id, array['owner', 'admin', 'barber']);
  select * into c from public.customers where id = p_customer_id and tenant_id = p_tenant_id;
  if c.id is null then
    perform private.fail('customer_not_found');
  end if;
  if m.role = 'barber' and not exists (select 1 from public.bookings b where b.customer_id = c.id and b.barber_id = m.barber_id) then
    perform private.fail('forbidden');
  end if;
  return jsonb_build_object(
    'customer', to_jsonb(c) - 'phone_normalized',
    'history', coalesce((select jsonb_agg(jsonb_build_object(
                  'id', b.id, 'status', b.status, 'starts_at', b.starts_at, 'service_name', b.snap_service_name,
                  'barber_name', b.snap_barber_name, 'price_cents', b.snap_price_cents, 'currency', b.snap_currency,
                  'paid_cents', case when m.role in ('owner', 'admin') then coalesce((
                     select sum(case when p.kind = 'payment' then p.amount_cents else -p.amount_cents end)
                     from public.payments p where p.booking_id = b.id), 0) end)
                  order by b.starts_at desc)
                 from public.bookings b where b.customer_id = c.id
                   and (m.role <> 'barber' or b.barber_id = m.barber_id)), '[]'::jsonb));
end $$;

create or replace function public.owner_update_customer(p_tenant_id uuid, p_customer_id uuid, p_patch jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_member(p_tenant_id, array['owner', 'admin']);
  update public.customers set
    name = coalesce(nullif(btrim(p_patch ->> 'name'), ''), name),
    email = case when p_patch ? 'email' then nullif(lower(btrim(p_patch ->> 'email')), '') else email end,
    internal_note = case when p_patch ? 'internal_note' then left(p_patch ->> 'internal_note', 2000) else internal_note end
  where id = p_customer_id and tenant_id = p_tenant_id;
  if not found then
    perform private.fail('customer_not_found');
  end if;
end $$;

-- Settings, opening hours, photos ----------------------------------------------------------
create or replace function public.owner_update_settings(p_tenant_id uuid, p_patch jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare k text;
begin
  perform private.require_member(p_tenant_id, array['owner']);
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('name', 'short_name', 'tagline', 'description', 'phone', 'email', 'address_line', 'city',
                 'postal_code', 'country', 'map_url', 'instagram', 'website', 'accent_color', 'logo_path',
                 'cover_path', 'slot_step_min', 'min_lead_min', 'max_advance_days', 'allow_self_cancel',
                 'cancel_min_notice_min', 'allow_self_reschedule', 'reschedule_min_notice_min',
                 'max_self_reschedules', 'reminder_offsets_min', 'notify_staff', 'ai_enabled') then
      perform private.fail('invalid_input', 'unknown_setting:' || k);
    end if;
  end loop;
  if (p_patch ? 'logo_path' and nullif(p_patch ->> 'logo_path', '') is not null and not (p_patch ->> 'logo_path') like p_tenant_id::text || '/%')
     or (p_patch ? 'cover_path' and nullif(p_patch ->> 'cover_path', '') is not null and not (p_patch ->> 'cover_path') like p_tenant_id::text || '/%') then
    perform private.fail('invalid_input', 'path');
  end if;
  begin
    update public.tenants t set
      name = coalesce(p_patch ->> 'name', t.name),
      short_name = coalesce(p_patch ->> 'short_name', t.short_name),
      tagline = case when p_patch ? 'tagline' then p_patch ->> 'tagline' else t.tagline end,
      description = case when p_patch ? 'description' then p_patch ->> 'description' else t.description end,
      phone = case when p_patch ? 'phone' then p_patch ->> 'phone' else t.phone end,
      email = case when p_patch ? 'email' then p_patch ->> 'email' else t.email end,
      address_line = case when p_patch ? 'address_line' then p_patch ->> 'address_line' else t.address_line end,
      city = case when p_patch ? 'city' then p_patch ->> 'city' else t.city end,
      postal_code = case when p_patch ? 'postal_code' then p_patch ->> 'postal_code' else t.postal_code end,
      country = case when p_patch ? 'country' then p_patch ->> 'country' else t.country end,
      map_url = case when p_patch ? 'map_url' then p_patch ->> 'map_url' else t.map_url end,
      instagram = case when p_patch ? 'instagram' then p_patch ->> 'instagram' else t.instagram end,
      website = case when p_patch ? 'website' then p_patch ->> 'website' else t.website end,
      accent_color = coalesce(p_patch ->> 'accent_color', t.accent_color),
      logo_path = case when p_patch ? 'logo_path' then nullif(p_patch ->> 'logo_path', '') else t.logo_path end,
      cover_path = case when p_patch ? 'cover_path' then nullif(p_patch ->> 'cover_path', '') else t.cover_path end,
      slot_step_min = coalesce((p_patch ->> 'slot_step_min')::int, t.slot_step_min),
      min_lead_min = coalesce((p_patch ->> 'min_lead_min')::int, t.min_lead_min),
      max_advance_days = coalesce((p_patch ->> 'max_advance_days')::int, t.max_advance_days),
      allow_self_cancel = coalesce((p_patch ->> 'allow_self_cancel')::boolean, t.allow_self_cancel),
      cancel_min_notice_min = coalesce((p_patch ->> 'cancel_min_notice_min')::int, t.cancel_min_notice_min),
      allow_self_reschedule = coalesce((p_patch ->> 'allow_self_reschedule')::boolean, t.allow_self_reschedule),
      reschedule_min_notice_min = coalesce((p_patch ->> 'reschedule_min_notice_min')::int, t.reschedule_min_notice_min),
      max_self_reschedules = coalesce((p_patch ->> 'max_self_reschedules')::int, t.max_self_reschedules),
      reminder_offsets_min = case when p_patch ? 'reminder_offsets_min'
        then (select coalesce(array_agg(x::int), '{}') from jsonb_array_elements_text(p_patch -> 'reminder_offsets_min') x)
        else t.reminder_offsets_min end,
      notify_staff = coalesce((p_patch ->> 'notify_staff')::boolean, t.notify_staff),
      ai_enabled = coalesce((p_patch ->> 'ai_enabled')::boolean, t.ai_enabled),
      owner_overrides = (select array_agg(distinct x) from unnest(t.owner_overrides || array['settings']) x)
    where t.id = p_tenant_id;
  exception when check_violation or not_null_violation or invalid_text_representation then
    perform private.fail('invalid_input', 'settings');
  end;
end $$;

create or replace function public.owner_set_opening_hours(p_tenant_id uuid, p_hours jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_member(p_tenant_id, array['owner', 'admin']);
  delete from public.opening_hours where tenant_id = p_tenant_id;
  begin
    insert into public.opening_hours (tenant_id, weekday, start_min, end_min)
    select p_tenant_id, (x ->> 'weekday')::int, (x ->> 'start_min')::int, (x ->> 'end_min')::int
    from jsonb_array_elements(coalesce(p_hours, '[]'::jsonb)) x;
  exception
    when exclusion_violation then perform private.fail('schedule_overlap');
    when check_violation then perform private.fail('invalid_input', 'hours');
  end;
  update public.tenants
     set owner_overrides = (select array_agg(distinct x) from unnest(owner_overrides || array['opening_hours']) x)
   where id = p_tenant_id;
end $$;

create or replace function public.owner_add_photo(p_tenant_id uuid, p_kind text, p_path text, p_alt text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.require_member(p_tenant_id, array['owner', 'admin']);
  if p_path is null or not p_path like p_tenant_id::text || '/%' then
    perform private.fail('invalid_input', 'path');
  end if;
  insert into public.tenant_photos (tenant_id, kind, storage_path, alt, sort_order, source)
  values (p_tenant_id, p_kind, p_path, left(coalesce(p_alt, ''), 200),
          coalesce((select max(sort_order) + 1 from public.tenant_photos where tenant_id = p_tenant_id and kind = p_kind), 0),
          'owner')
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.owner_update_photo(p_tenant_id uuid, p_photo_id uuid, p_patch jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_member(p_tenant_id, array['owner', 'admin']);
  update public.tenant_photos set
    alt = case when p_patch ? 'alt' then left(p_patch ->> 'alt', 200) else alt end,
    sort_order = coalesce((p_patch ->> 'sort_order')::int, sort_order),
    is_active = coalesce((p_patch ->> 'is_active')::boolean, is_active),
    kind = coalesce(p_patch ->> 'kind', kind)
  where id = p_photo_id and tenant_id = p_tenant_id;
  if not found then
    perform private.fail('photo_not_found');
  end if;
end $$;

-- Explicit deletion: removes the row; the client deletes the storage object.
create or replace function public.owner_delete_photo(p_tenant_id uuid, p_photo_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_path text;
begin
  perform private.require_member(p_tenant_id, array['owner', 'admin']);
  delete from public.tenant_photos where id = p_photo_id and tenant_id = p_tenant_id returning storage_path into v_path;
  if v_path is null then
    perform private.fail('photo_not_found');
  end if;
  return v_path;
end $$;

-- Staff push ------------------------------------------------------------------------------
create or replace function public.owner_register_push(p_tenant_id uuid, p_subscription jsonb, p_user_agent text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.require_member(p_tenant_id, array['owner', 'admin', 'barber']);
  insert into public.push_subscriptions as ps (tenant_id, audience, user_id, endpoint, p256dh, auth_secret, user_agent)
  values (p_tenant_id, 'staff', auth.uid(), p_subscription ->> 'endpoint',
          p_subscription #>> '{keys,p256dh}', p_subscription #>> '{keys,auth}', left(p_user_agent, 300))
  on conflict (tenant_id, endpoint,
               coalesce(booking_id, '00000000-0000-0000-0000-000000000000'::uuid),
               coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set p256dh = excluded.p256dh, auth_secret = excluded.auth_secret, disabled_at = null
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.owner_unregister_push(p_tenant_id uuid, p_endpoint text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_member(p_tenant_id, array['owner', 'admin', 'barber']);
  update public.push_subscriptions set disabled_at = now()
   where tenant_id = p_tenant_id and user_id = auth.uid() and endpoint = p_endpoint and disabled_at is null;
end $$;

-- Go live ---------------------------------------------------------------------------------
create or replace function private.go_live_problems(p_tenant_id uuid)
returns text[] language sql stable security definer set search_path = '' as $$
  select array_remove(array[
    case when not exists (select 1 from public.services s where s.tenant_id = p_tenant_id and s.is_active)
         then 'no_active_services' end,
    case when not exists (select 1 from public.barbers b
                          join public.barber_services bs on bs.barber_id = b.id
                          join public.services s on s.id = bs.service_id and s.is_active
                          join public.barber_weekly_hours h on h.barber_id = b.id
                          where b.tenant_id = p_tenant_id and b.is_active)
         then 'no_bookable_barber' end,
    case when coalesce(btrim(t.phone), '') = '' then 'missing_phone' end,
    case when coalesce(btrim(t.address_line), '') = '' then 'missing_address' end,
    case when exists (select 1 from public.services s where s.tenant_id = p_tenant_id and s.is_active
                        and not exists (select 1 from public.barber_services bs join public.barbers b on b.id = bs.barber_id
                                        where bs.service_id = s.id and b.is_active))
         then 'service_without_barber' end
  ], null)
  from public.tenants t where t.id = p_tenant_id
$$;

create or replace function public.owner_go_live(p_tenant_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_problems text[];
  v_purged int;
begin
  perform private.require_member(p_tenant_id, array['owner']);
  v_problems := private.go_live_problems(p_tenant_id);
  if cardinality(v_problems) > 0 then
    perform private.fail('not_ready', array_to_string(v_problems, ','));
  end if;
  perform set_config('app.purge_demo', 'on', true);
  delete from public.payments p using public.bookings b
   where p.booking_id = b.id and b.tenant_id = p_tenant_id and b.is_demo;
  delete from public.bookings where tenant_id = p_tenant_id and is_demo;
  get diagnostics v_purged = row_count;
  delete from public.customers c where c.tenant_id = p_tenant_id and c.is_demo
    and not exists (select 1 from public.bookings b where b.customer_id = c.id);
  perform set_config('app.purge_demo', 'off', true);
  update public.tenants set status = 'live', live_at = now() where id = p_tenant_id and status = 'preview';
  return jsonb_build_object('status', 'live', 'purged_demo_bookings', v_purged);
end $$;

create or replace function public.owner_go_live_check(p_tenant_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_member(p_tenant_id, array['owner', 'admin']);
  return jsonb_build_object('problems', to_jsonb(private.go_live_problems(p_tenant_id)),
                            'demo_bookings', (select count(*) from public.bookings where tenant_id = p_tenant_id and is_demo));
end $$;
