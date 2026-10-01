-- Public (anon) API. Clients never pass tenant_id, price, duration or any
-- other trusted value: the slug identifies the shop and everything else is
-- read from the database inside these SECURITY DEFINER functions.

create or replace function private.tenant_by_slug(p_slug text)
returns public.tenants language plpgsql stable security definer set search_path = '' as $$
declare v public.tenants;
begin
  select * into v from public.tenants t where t.slug = lower(btrim(p_slug)) and t.status in ('preview', 'live');
  if v.id is null then
    perform private.fail('tenant_not_found');
  end if;
  return v;
end $$;

create or replace function private.local_today(p_tz text)
returns date language sql stable as $$ select (now() at time zone p_tz)::date $$;

create or replace function private.public_rate(p_kind text, p_limit int, p_window int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.enforce_rate(p_kind || ':' || private.client_ip(), p_limit, p_window);
end $$;

-- Shop page payload ---------------------------------------------------------
create or replace function public.get_tenant_public(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_t public.tenants;
  v_today date;
begin
  v_t := private.tenant_by_slug(p_slug);
  v_today := private.local_today(v_t.timezone);
  return jsonb_build_object(
    'tenant', jsonb_build_object(
      'id', v_t.id, 'slug', v_t.slug, 'status', v_t.status, 'is_demo', v_t.is_demo,
      'name', v_t.name, 'short_name', v_t.short_name, 'tagline', v_t.tagline,
      'description', v_t.description, 'timezone', v_t.timezone, 'locale', v_t.locale,
      'currency', v_t.currency, 'accent_color', v_t.accent_color,
      'phone', v_t.phone, 'email', v_t.email, 'address_line', v_t.address_line,
      'city', v_t.city, 'postal_code', v_t.postal_code, 'country', v_t.country,
      'lat', v_t.lat, 'lng', v_t.lng, 'map_url', v_t.map_url,
      'instagram', v_t.instagram, 'website', v_t.website,
      'logo_path', v_t.logo_path, 'cover_path', v_t.cover_path,
      'ai_enabled', v_t.ai_enabled,
      'rules', jsonb_build_object(
        'slot_step_min', v_t.slot_step_min, 'min_lead_min', v_t.min_lead_min,
        'max_advance_days', v_t.max_advance_days,
        'allow_self_cancel', v_t.allow_self_cancel, 'cancel_min_notice_min', v_t.cancel_min_notice_min,
        'allow_self_reschedule', v_t.allow_self_reschedule,
        'reschedule_min_notice_min', v_t.reschedule_min_notice_min)),
    'today', v_today,
    'opening_hours', coalesce((
      select jsonb_agg(jsonb_build_object('weekday', h.weekday, 'start_min', h.start_min, 'end_min', h.end_min)
                       order by h.weekday, h.start_min)
      from public.opening_hours h where h.tenant_id = v_t.id), '[]'::jsonb),
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'kind', p.kind, 'path', p.storage_path, 'alt', p.alt)
                       order by p.kind, p.sort_order, p.created_at)
      from public.tenant_photos p where p.tenant_id = v_t.id and p.is_active), '[]'::jsonb),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'name', s.name, 'description', s.description,
               'duration_min', s.duration_min, 'price_cents', s.price_cents,
               'barber_ids', coalesce((select jsonb_agg(bs.barber_id order by b.sort_order)
                                        from public.barber_services bs
                                        join public.barbers b on b.id = bs.barber_id and b.is_active
                                        where bs.service_id = s.id), '[]'::jsonb))
             order by s.sort_order, s.name)
      from public.services s where s.tenant_id = v_t.id and s.is_active), '[]'::jsonb),
    'barbers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', b.id, 'name', b.name, 'title', b.title, 'bio', b.bio,
               'photo_path', b.photo_path, 'specialties', to_jsonb(b.specialties),
               'color', b.color, 'marker', b.marker,
               'service_ids', coalesce((select jsonb_agg(bs.service_id) from public.barber_services bs
                                        join public.services s on s.id = bs.service_id and s.is_active
                                        where bs.barber_id = b.id), '[]'::jsonb),
               'works_today', not isempty(private.barber_work_ranges(b.id, v_today)))
             order by b.sort_order, b.name)
      from public.barbers b where b.tenant_id = v_t.id and b.is_active), '[]'::jsonb)
  );
end $$;

-- Slots for one local date ----------------------------------------------------
create or replace function public.get_available_slots(
  p_slug text, p_service_id uuid, p_barber_id uuid default null, p_date date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_t public.tenants;
  v_today date;
  v_date date;
begin
  perform private.public_rate('read', 240, 60);
  v_t := private.tenant_by_slug(p_slug);
  v_today := private.local_today(v_t.timezone);
  v_date := coalesce(p_date, v_today);
  if not exists (select 1 from public.services where id = p_service_id and tenant_id = v_t.id and is_active) then
    perform private.fail('service_not_found');
  end if;
  if p_barber_id is not null and not exists (
      select 1 from public.barbers b join public.barber_services bs on bs.barber_id = b.id
      where b.id = p_barber_id and b.tenant_id = v_t.id and b.is_active and bs.service_id = p_service_id) then
    perform private.fail('barber_not_eligible');
  end if;
  if v_date < v_today or v_date > v_today + v_t.max_advance_days then
    return jsonb_build_object('date', v_date, 'timezone', v_t.timezone, 'slots', '[]'::jsonb,
                              'out_of_range', true);
  end if;
  return jsonb_build_object(
    'date', v_date, 'timezone', v_t.timezone, 'out_of_range', false,
    'slots', coalesce((
      select jsonb_agg(jsonb_build_object(
               'starts_at', x.starts_at,
               'local_time', to_char(x.starts_at at time zone v_t.timezone, 'HH24:MI'),
               'barber_ids', x.barber_ids) order by x.starts_at)
      from (select c.starts_at, jsonb_agg(c.barber_id) as barber_ids
            from private.compute_slots(v_t.id, p_service_id, p_barber_id, v_date) c
            group by c.starts_at) x), '[]'::jsonb));
end $$;

-- Which dates in a window have at least one slot (for the date strip).
create or replace function public.get_available_dates(
  p_slug text, p_service_id uuid, p_barber_id uuid default null,
  p_from date default null, p_days int default 14)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_t public.tenants;
  v_today date;
  v_from date;
  v_to date;
begin
  perform private.public_rate('read', 240, 60);
  v_t := private.tenant_by_slug(p_slug);
  v_today := private.local_today(v_t.timezone);
  v_from := greatest(coalesce(p_from, v_today), v_today);
  v_to := least(v_from + least(greatest(coalesce(p_days, 14), 1), 31) - 1, v_today + v_t.max_advance_days);
  if not exists (select 1 from public.services where id = p_service_id and tenant_id = v_t.id and is_active) then
    perform private.fail('service_not_found');
  end if;
  return jsonb_build_object(
    'timezone', v_t.timezone, 'today', v_today, 'from', v_from, 'to', v_to,
    'max_date', v_today + v_t.max_advance_days,
    'dates', coalesce((
      select jsonb_agg(jsonb_build_object('date', d.d::date, 'slots',
               (select count(distinct c.starts_at)
                from private.compute_slots(v_t.id, p_service_id, p_barber_id, d.d::date) c))
             order by d.d)
      from generate_series(v_from, v_to, interval '1 day') d(d)), '[]'::jsonb));
end $$;

-- Booking view for the token holder --------------------------------------------
create or replace function private.booking_public_view(p_booking_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', b.id, 'status', b.status, 'starts_at', b.starts_at, 'ends_at', b.ends_at,
    'timezone', b.snap_timezone,
    'local_date', to_char(b.starts_at at time zone b.snap_timezone, 'YYYY-MM-DD'),
    'local_time', to_char(b.starts_at at time zone b.snap_timezone, 'HH24:MI'),
    'service', jsonb_build_object('id', b.service_id, 'name', b.snap_service_name,
                                  'duration_min', b.snap_duration_min,
                                  'price_cents', b.snap_price_cents, 'currency', b.snap_currency),
    'barber', jsonb_build_object('id', b.barber_id, 'name', b.snap_barber_name,
                                 'photo_path', br.photo_path),
    'tenant', jsonb_build_object('slug', t.slug, 'name', b.snap_tenant_name, 'phone', t.phone,
                                 'address_line', t.address_line, 'city', t.city, 'map_url', t.map_url),
    'customer', jsonb_build_object('name', b.snap_customer_name,
                                   'phone_masked', regexp_replace(b.snap_customer_phone, '\d(?=(\D*\d){2})', '•', 'g'),
                                   'email', b.snap_customer_email),
    'version', b.version,
    'reschedule_count', b.reschedule_count,
    'is_demo', b.is_demo,
    'cancelled_at', b.cancelled_at,
    'policy', b.snap_policy,
    'actions', private.client_policy(b.id))
  from public.bookings b
  join public.tenants t on t.id = b.tenant_id
  join public.barbers br on br.id = b.barber_id
  where b.id = p_booking_id
$$;

create or replace function private.booking_by_token(p_token text)
returns public.bookings language plpgsql stable security definer set search_path = '' as $$
declare v public.bookings;
begin
  if p_token is null or length(p_token) < 32 or length(p_token) > 128 then
    perform private.fail('booking_not_found');
  end if;
  select * into v from public.bookings b where b.token_hash = private.token_hash(p_token);
  if v.id is null then
    perform private.fail('booking_not_found');
  end if;
  return v;
end $$;

-- Create ----------------------------------------------------------------------
create or replace function public.create_booking(
  p_slug text, p_service_id uuid, p_barber_id uuid, p_starts_at timestamptz,
  p_customer jsonb, p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_t public.tenants;
  v_name text := btrim(coalesce(p_customer ->> 'name', ''));
  v_phone text := btrim(coalesce(p_customer ->> 'phone', ''));
  v_email text := nullif(lower(btrim(coalesce(p_customer ->> 'email', ''))), '');
  v_hash text;
  v_existing public.bookings;
  v_customer uuid;
  v_id uuid;
  v_local_date date;
begin
  v_t := private.tenant_by_slug(p_slug);
  if p_idempotency_key is null then
    perform private.fail('invalid_input', 'idempotency_key');
  end if;
  -- Serialize retries of the same request.
  perform pg_advisory_xact_lock(hashtextextended(v_t.id::text || ':' || p_idempotency_key::text, 0));

  v_hash := private.sha256_hex(jsonb_build_object(
    'service', p_service_id, 'barber', p_barber_id, 'start', p_starts_at,
    'name', v_name, 'phone', private.normalize_phone(v_phone), 'email', v_email)::text);

  select * into v_existing from public.bookings
   where tenant_id = v_t.id and idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    if v_existing.request_hash is distinct from v_hash then
      perform private.fail('idempotency_mismatch');
    end if;
    return jsonb_build_object('booking_id', v_existing.id, 'replayed', true,
                              'token', private.booking_token(v_t.id, p_idempotency_key),
                              'booking', private.booking_public_view(v_existing.id));
  end if;

  perform private.public_rate('create_booking', 12, 600);
  perform private.enforce_rate('create_booking_tenant:' || v_t.id, 400, 3600);

  if length(v_name) < 1 or length(v_name) > 80 then
    perform private.fail('invalid_name');
  end if;
  if private.normalize_phone(v_phone) is null then
    perform private.fail('invalid_phone');
  end if;
  if v_email is not null and v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    perform private.fail('invalid_email');
  end if;

  v_local_date := (p_starts_at at time zone v_t.timezone)::date;
  if p_starts_at < now() + make_interval(mins => v_t.min_lead_min) then
    perform private.fail('slot_unavailable', 'too_soon');
  end if;
  if v_local_date > private.local_today(v_t.timezone) + v_t.max_advance_days then
    perform private.fail('slot_unavailable', 'too_far');
  end if;
  -- Align to the tenant grid so clients cannot craft odd start times.
  if (extract(epoch from (p_starts_at - private.local_ts(v_local_date, 0, v_t.timezone)))::bigint / 60)
       % v_t.slot_step_min <> 0 then
    perform private.fail('slot_unavailable', 'off_grid');
  end if;

  v_customer := private.upsert_customer(v_t.id, v_name, v_phone, v_email, v_t.status = 'preview');
  v_id := private.do_create_booking(v_t.id, p_service_id, p_barber_id, p_starts_at, v_customer,
                                    'client', null, true, p_idempotency_key, v_hash,
                                    v_t.status = 'preview', '');
  return jsonb_build_object('booking_id', v_id, 'replayed', false,
                            'token', private.booking_token(v_t.id, p_idempotency_key),
                            'booking', private.booking_public_view(v_id));
end $$;

create or replace function public.get_booking_by_token(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.bookings;
begin
  perform private.public_rate('token', 120, 60);
  v := private.booking_by_token(p_token);
  return private.booking_public_view(v.id);
end $$;

create or replace function public.cancel_booking_by_token(p_token text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.bookings;
  v_policy jsonb;
begin
  perform private.public_rate('token', 120, 60);
  v := private.booking_by_token(p_token);
  if v.status = 'cancelled' then
    return private.booking_public_view(v.id); -- idempotent retry
  end if;
  v_policy := private.client_policy(v.id);
  if not (v_policy ->> 'can_cancel')::boolean then
    perform private.fail('policy_violation', v_policy ->> 'cancel_block_reason');
  end if;
  perform private.do_cancel_booking(v.id, 'client', null, left(p_reason, 500));
  return private.booking_public_view(v.id);
end $$;

create or replace function public.reschedule_booking_by_token(
  p_token text, p_new_starts_at timestamptz, p_barber_id uuid default null,
  p_any_barber boolean default false, p_idempotency_key uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.bookings;
  v_t public.tenants;
  v_policy jsonb;
  v_hash text;
  v_prev record;
  v_mode text;
  v_result jsonb;
  v_local_date date;
begin
  perform private.public_rate('token', 120, 60);
  if p_idempotency_key is null then
    perform private.fail('invalid_input', 'idempotency_key');
  end if;
  v := private.booking_by_token(p_token);
  select * into v_t from public.tenants where id = v.tenant_id;
  perform pg_advisory_xact_lock(hashtextextended(v.id::text || ':reschedule:' || p_idempotency_key::text, 0));
  v_hash := private.sha256_hex(jsonb_build_object('booking', v.id, 'start', p_new_starts_at,
                                                  'barber', p_barber_id, 'any', p_any_barber)::text);
  select * into v_prev from public.idempotency_records
   where tenant_id = v.tenant_id and scope = 'reschedule:' || v.id and key = p_idempotency_key;
  if v_prev.key is not null then
    if v_prev.request_hash <> v_hash then
      perform private.fail('idempotency_mismatch');
    end if;
    return private.booking_public_view(v.id);
  end if;

  v_policy := private.client_policy(v.id);
  if not (v_policy ->> 'can_reschedule')::boolean then
    perform private.fail('policy_violation', v_policy ->> 'reschedule_block_reason');
  end if;
  if p_new_starts_at < now() + make_interval(mins => v_t.min_lead_min) then
    perform private.fail('slot_unavailable', 'too_soon');
  end if;
  v_local_date := (p_new_starts_at at time zone v_t.timezone)::date;
  if v_local_date > private.local_today(v_t.timezone) + v_t.max_advance_days then
    perform private.fail('slot_unavailable', 'too_far');
  end if;
  if (extract(epoch from (p_new_starts_at - private.local_ts(v_local_date, 0, v_t.timezone)))::bigint / 60)
       % v_t.slot_step_min <> 0 then
    perform private.fail('slot_unavailable', 'off_grid');
  end if;

  v_mode := case when p_any_barber then 'any' when p_barber_id is null or p_barber_id = v.barber_id then 'same' else 'barber' end;
  perform private.do_reschedule_booking(v.id, p_new_starts_at, v_mode, p_barber_id, true, 'client', null);
  v_result := private.booking_public_view(v.id);
  insert into public.idempotency_records (tenant_id, scope, key, request_hash, result)
  values (v.tenant_id, 'reschedule:' || v.id, p_idempotency_key, v_hash, jsonb_build_object('booking_id', v.id));
  return v_result;
end $$;

-- Customer push subscription bound to one booking.
create or replace function public.register_customer_push(p_token text, p_subscription jsonb, p_user_agent text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.bookings; v_id uuid;
begin
  perform private.public_rate('token', 120, 60);
  v := private.booking_by_token(p_token);
  insert into public.push_subscriptions as ps (tenant_id, audience, booking_id, endpoint, p256dh, auth_secret, user_agent)
  values (v.tenant_id, 'customer', v.id, p_subscription ->> 'endpoint',
          p_subscription #>> '{keys,p256dh}', p_subscription #>> '{keys,auth}', left(p_user_agent, 300))
  on conflict (tenant_id, endpoint,
               coalesce(booking_id, '00000000-0000-0000-0000-000000000000'::uuid),
               coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set p256dh = excluded.p256dh, auth_secret = excluded.auth_secret, disabled_at = null
  returning id into v_id;
  return jsonb_build_object('subscription_id', v_id);
end $$;

create or replace function public.unregister_customer_push(p_token text, p_endpoint text)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.bookings;
begin
  v := private.booking_by_token(p_token);
  update public.push_subscriptions set disabled_at = now()
   where booking_id = v.id and endpoint = p_endpoint and disabled_at is null;
end $$;
