-- Tenant pipeline: business.json (normalized by scripts/tenant) -> database.
-- Atomic, idempotent, additive. Never deletes bookings, customers, payments,
-- owner-created barbers/services or owner-uploaded photos. Entities the owner
-- edited in the cabinet (managed_by = 'owner') are skipped unless p_force.

create or replace function public.pipeline_publish_tenant(p_config jsonb, p_force boolean default false, p_prune boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_slug text := p_config ->> 'slug';
  v_t public.tenants;
  v_created boolean := false;
  v_item jsonb;
  v_id uuid;
  v_report jsonb := jsonb_build_object('services', jsonb_build_object('inserted', 0, 'updated', 0, 'skipped_owner', '[]'::jsonb, 'deactivated', 0),
                                       'barbers', jsonb_build_object('inserted', 0, 'updated', 0, 'skipped_owner', '[]'::jsonb, 'deactivated', 0),
                                       'photos', jsonb_build_object('upserted', 0, 'removed_pipeline', 0, 'kept_owner', 0),
                                       'sections_skipped', '[]'::jsonb);
  v_existing record;
  v_bid uuid;
  v_settings_locked boolean;
  v_hours_locked boolean;
begin
  perform private.require_service_role();
  if v_slug is null then
    perform private.fail('invalid_input', 'slug');
  end if;

  select * into v_t from public.tenants where slug = v_slug for update;
  if v_t.id is null then
    insert into public.tenants (slug, name, short_name, timezone, currency, accent_color, locale, is_demo, status)
    values (v_slug, p_config ->> 'name', p_config ->> 'short_name', p_config ->> 'timezone',
            p_config ->> 'currency', p_config ->> 'accent_color', coalesce(p_config ->> 'locale', 'de'),
            coalesce((p_config ->> 'is_demo')::boolean, false), 'preview')
    returning * into v_t;
    v_created := true;
  end if;

  v_settings_locked := 'settings' = any(v_t.owner_overrides) and not p_force;
  v_hours_locked := 'opening_hours' = any(v_t.owner_overrides) and not p_force;

  -- Identity fields that define the tenant always follow the config.
  update public.tenants set
    timezone = p_config ->> 'timezone',
    currency = p_config ->> 'currency',
    locale = coalesce(p_config ->> 'locale', locale),
    is_demo = coalesce((p_config ->> 'is_demo')::boolean, is_demo),
    config_version = config_version + 1,
    config_hash = p_config ->> 'config_hash',
    published_at = now(),
    owner_overrides = case when p_force then '{}' else owner_overrides end
  where id = v_t.id;

  if v_settings_locked then
    v_report := jsonb_set(v_report, '{sections_skipped}', (v_report -> 'sections_skipped') || '"settings"');
  else
    update public.tenants set
      name = p_config ->> 'name',
      short_name = p_config ->> 'short_name',
      tagline = p_config ->> 'tagline',
      description = p_config ->> 'description',
      accent_color = p_config ->> 'accent_color',
      phone = p_config #>> '{contact,phone}',
      email = p_config #>> '{contact,email}',
      instagram = p_config #>> '{contact,instagram}',
      website = p_config #>> '{contact,website}',
      address_line = p_config #>> '{location,address_line}',
      city = p_config #>> '{location,city}',
      postal_code = p_config #>> '{location,postal_code}',
      country = p_config #>> '{location,country}',
      lat = (p_config #>> '{location,lat}')::double precision,
      lng = (p_config #>> '{location,lng}')::double precision,
      map_url = p_config #>> '{location,map_url}',
      logo_path = coalesce(p_config #>> '{branding,logo_path}', logo_path),
      cover_path = coalesce(p_config #>> '{branding,cover_path}', cover_path),
      slot_step_min = coalesce((p_config #>> '{rules,slot_step_min}')::int, slot_step_min),
      min_lead_min = coalesce((p_config #>> '{rules,min_lead_min}')::int, min_lead_min),
      max_advance_days = coalesce((p_config #>> '{rules,max_advance_days}')::int, max_advance_days),
      allow_self_cancel = coalesce((p_config #>> '{rules,allow_self_cancel}')::boolean, allow_self_cancel),
      cancel_min_notice_min = coalesce((p_config #>> '{rules,cancel_min_notice_min}')::int, cancel_min_notice_min),
      allow_self_reschedule = coalesce((p_config #>> '{rules,allow_self_reschedule}')::boolean, allow_self_reschedule),
      reschedule_min_notice_min = coalesce((p_config #>> '{rules,reschedule_min_notice_min}')::int, reschedule_min_notice_min),
      max_self_reschedules = coalesce((p_config #>> '{rules,max_self_reschedules}')::int, max_self_reschedules),
      reminder_offsets_min = coalesce((select array_agg(x::int) from jsonb_array_elements_text(p_config #> '{notifications,reminder_offsets_min}') x), reminder_offsets_min),
      notify_staff = coalesce((p_config #>> '{notifications,notify_staff}')::boolean, notify_staff),
      ai_enabled = coalesce((p_config #>> '{ai,enabled}')::boolean, ai_enabled),
      ai_daily_request_limit = coalesce((p_config #>> '{ai,daily_request_limit}')::int, ai_daily_request_limit),
      ai_daily_token_limit = coalesce((p_config #>> '{ai,daily_token_limit}')::int, ai_daily_token_limit),
      legal = coalesce(p_config -> 'legal', legal),
      retention_months = coalesce((p_config #>> '{legal,privacy,retention_months}')::int, retention_months)
    where id = v_t.id;
  end if;

  if v_hours_locked then
    v_report := jsonb_set(v_report, '{sections_skipped}', (v_report -> 'sections_skipped') || '"opening_hours"');
  else
    delete from public.opening_hours where tenant_id = v_t.id;
    insert into public.opening_hours (tenant_id, weekday, start_min, end_min)
    select v_t.id, (x ->> 'weekday')::int, (x ->> 'start_min')::int, (x ->> 'end_min')::int
    from jsonb_array_elements(coalesce(p_config -> 'opening_hours', '[]'::jsonb)) x;
  end if;

  -- Services --------------------------------------------------------------
  for v_item in select * from jsonb_array_elements(coalesce(p_config -> 'services', '[]'::jsonb)) loop
    select * into v_existing from public.services where tenant_id = v_t.id and pipeline_key = v_item ->> 'key';
    if v_existing.id is null then
      insert into public.services (tenant_id, pipeline_key, managed_by, name, description, duration_min, buffer_min,
                                   price_cents, is_active, sort_order, allow_self_cancel, cancel_min_notice_min,
                                   allow_self_reschedule, reschedule_min_notice_min)
      values (v_t.id, v_item ->> 'key', 'pipeline', v_item ->> 'name', v_item ->> 'description',
              (v_item ->> 'duration_min')::int, coalesce((v_item ->> 'buffer_min')::int, 0),
              (v_item ->> 'price_cents')::int, coalesce((v_item ->> 'active')::boolean, true),
              coalesce((v_item ->> 'sort_order')::int, 0),
              (v_item #>> '{policy,allow_self_cancel}')::boolean, (v_item #>> '{policy,cancel_min_notice_min}')::int,
              (v_item #>> '{policy,allow_self_reschedule}')::boolean, (v_item #>> '{policy,reschedule_min_notice_min}')::int);
      v_report := jsonb_set(v_report, '{services,inserted}', to_jsonb((v_report #>> '{services,inserted}')::int + 1));
    elsif v_existing.managed_by = 'owner' and not p_force then
      v_report := jsonb_set(v_report, '{services,skipped_owner}', (v_report #> '{services,skipped_owner}') || to_jsonb(v_item ->> 'key'));
    else
      update public.services set
        managed_by = 'pipeline', name = v_item ->> 'name', description = v_item ->> 'description',
        duration_min = (v_item ->> 'duration_min')::int, buffer_min = coalesce((v_item ->> 'buffer_min')::int, 0),
        price_cents = (v_item ->> 'price_cents')::int, is_active = coalesce((v_item ->> 'active')::boolean, true),
        sort_order = coalesce((v_item ->> 'sort_order')::int, 0),
        allow_self_cancel = (v_item #>> '{policy,allow_self_cancel}')::boolean,
        cancel_min_notice_min = (v_item #>> '{policy,cancel_min_notice_min}')::int,
        allow_self_reschedule = (v_item #>> '{policy,allow_self_reschedule}')::boolean,
        reschedule_min_notice_min = (v_item #>> '{policy,reschedule_min_notice_min}')::int
      where id = v_existing.id;
      v_report := jsonb_set(v_report, '{services,updated}', to_jsonb((v_report #>> '{services,updated}')::int + 1));
    end if;
  end loop;

  -- Barbers ------------------------------------------------------------------
  for v_item in select * from jsonb_array_elements(coalesce(p_config -> 'barbers', '[]'::jsonb)) loop
    select * into v_existing from public.barbers where tenant_id = v_t.id and pipeline_key = v_item ->> 'key';
    if v_existing.id is not null and v_existing.managed_by = 'owner' and not p_force then
      v_report := jsonb_set(v_report, '{barbers,skipped_owner}', (v_report #> '{barbers,skipped_owner}') || to_jsonb(v_item ->> 'key'));
      continue;
    end if;
    if v_existing.id is null then
      insert into public.barbers (tenant_id, pipeline_key, managed_by, name, title, bio, photo_path, photo_source,
                                  specialties, color, marker, is_active, sort_order)
      values (v_t.id, v_item ->> 'key', 'pipeline', v_item ->> 'name', v_item ->> 'title', v_item ->> 'bio',
              v_item ->> 'photo_path', case when v_item ->> 'photo_path' is not null then 'pipeline' end,
              coalesce((select array_agg(x) from jsonb_array_elements_text(v_item -> 'specialties') x), '{}'),
              coalesce(v_item ->> 'color', '#9CA3AF'), coalesce(v_item ->> 'marker', ''),
              coalesce((v_item ->> 'active')::boolean, true), coalesce((v_item ->> 'sort_order')::int, 0))
      returning id into v_bid;
      v_report := jsonb_set(v_report, '{barbers,inserted}', to_jsonb((v_report #>> '{barbers,inserted}')::int + 1));
    else
      v_bid := v_existing.id;
      update public.barbers set
        managed_by = 'pipeline', name = v_item ->> 'name', title = v_item ->> 'title', bio = v_item ->> 'bio',
        photo_path = case when photo_source = 'owner' and not p_force then photo_path else coalesce(v_item ->> 'photo_path', photo_path) end,
        photo_source = case when photo_source = 'owner' and not p_force then photo_source
                            when v_item ->> 'photo_path' is not null then 'pipeline' else photo_source end,
        specialties = coalesce((select array_agg(x) from jsonb_array_elements_text(v_item -> 'specialties') x), '{}'),
        color = coalesce(v_item ->> 'color', color), marker = coalesce(v_item ->> 'marker', marker),
        is_active = coalesce((v_item ->> 'active')::boolean, true),
        sort_order = coalesce((v_item ->> 'sort_order')::int, 0)
      where id = v_bid;
      v_report := jsonb_set(v_report, '{barbers,updated}', to_jsonb((v_report #>> '{barbers,updated}')::int + 1));
    end if;

    delete from public.barber_services where barber_id = v_bid;
    insert into public.barber_services (tenant_id, barber_id, service_id)
    select v_t.id, v_bid, s.id
    from jsonb_array_elements_text(coalesce(v_item -> 'services', '[]'::jsonb)) k
    join public.services s on s.tenant_id = v_t.id and s.pipeline_key = k;

    delete from public.barber_weekly_hours where barber_id = v_bid;
    insert into public.barber_weekly_hours (tenant_id, barber_id, weekday, start_min, end_min)
    select v_t.id, v_bid, (x ->> 'weekday')::int, (x ->> 'start_min')::int, (x ->> 'end_min')::int
    from jsonb_array_elements(coalesce(v_item -> 'hours', '[]'::jsonb)) x;

    delete from public.barber_weekly_breaks where barber_id = v_bid;
    insert into public.barber_weekly_breaks (tenant_id, barber_id, weekday, start_min, end_min, label)
    select v_t.id, v_bid, (x ->> 'weekday')::int, (x ->> 'start_min')::int, (x ->> 'end_min')::int, coalesce(x ->> 'label', '')
    from jsonb_array_elements(coalesce(v_item -> 'breaks', '[]'::jsonb)) x;
  end loop;

  -- Explicit prune: deactivate pipeline-managed entities missing from config.
  if p_prune then
    with d as (
      update public.services set is_active = false
       where tenant_id = v_t.id and managed_by = 'pipeline' and is_active
         and pipeline_key not in (select x ->> 'key' from jsonb_array_elements(coalesce(p_config -> 'services', '[]'::jsonb)) x)
      returning 1)
    select jsonb_set(v_report, '{services,deactivated}', to_jsonb(count(*))) into v_report from d;
    with d as (
      update public.barbers set is_active = false
       where tenant_id = v_t.id and managed_by = 'pipeline' and is_active
         and pipeline_key not in (select x ->> 'key' from jsonb_array_elements(coalesce(p_config -> 'barbers', '[]'::jsonb)) x)
      returning 1)
    select jsonb_set(v_report, '{barbers,deactivated}', to_jsonb(count(*))) into v_report from d;
  end if;

  -- Photos: pipeline rows follow the config; owner uploads are never touched.
  with d as (
    delete from public.tenant_photos
     where tenant_id = v_t.id and source = 'pipeline'
       and pipeline_key not in (select x ->> 'key' from jsonb_array_elements(coalesce(p_config -> 'photos', '[]'::jsonb)) x)
    returning 1)
  select jsonb_set(v_report, '{photos,removed_pipeline}', to_jsonb(count(*))) into v_report from d;
  insert into public.tenant_photos (tenant_id, kind, storage_path, alt, sort_order, source, pipeline_key)
  select v_t.id, x ->> 'kind', x ->> 'path', coalesce(x ->> 'alt', ''), coalesce((x ->> 'sort_order')::int, 0),
         'pipeline', x ->> 'key'
  from jsonb_array_elements(coalesce(p_config -> 'photos', '[]'::jsonb)) x
  on conflict (tenant_id, pipeline_key) do update
    set kind = excluded.kind, storage_path = excluded.storage_path, alt = excluded.alt, sort_order = excluded.sort_order;
  v_report := jsonb_set(v_report, '{photos,upserted}', to_jsonb(jsonb_array_length(coalesce(p_config -> 'photos', '[]'::jsonb))));
  v_report := jsonb_set(v_report, '{photos,kept_owner}',
                        to_jsonb((select count(*) from public.tenant_photos where tenant_id = v_t.id and source = 'owner')));

  -- Special dates from config (future only; owner-made overrides untouched).
  delete from public.schedule_overrides
   where tenant_id = v_t.id and source = 'pipeline' and on_date >= private.local_today(p_config ->> 'timezone');
  for v_item in select * from jsonb_array_elements(coalesce(p_config -> 'special_dates', '[]'::jsonb)) loop
    if (v_item ->> 'date')::date < private.local_today(p_config ->> 'timezone') then
      continue;
    end if;
    v_bid := case when v_item ->> 'barber' is null then null
                  else (select id from public.barbers where tenant_id = v_t.id and pipeline_key = v_item ->> 'barber') end;
    if v_item ->> 'barber' is not null and v_bid is null then
      continue;
    end if;
    delete from public.schedule_overrides
     where tenant_id = v_t.id and on_date = (v_item ->> 'date')::date and barber_id is not distinct from v_bid
       and source = 'owner' and p_force;
    if coalesce((v_item ->> 'closed')::boolean, false) then
      insert into public.schedule_overrides (tenant_id, barber_id, on_date, note, source)
      values (v_t.id, v_bid, (v_item ->> 'date')::date, coalesce(v_item ->> 'note', ''), 'pipeline')
      on conflict do nothing;
    else
      insert into public.schedule_overrides (tenant_id, barber_id, on_date, start_min, end_min, note, source)
      select v_t.id, v_bid, (v_item ->> 'date')::date, (x ->> 'start_min')::int, (x ->> 'end_min')::int,
             coalesce(v_item ->> 'note', ''), 'pipeline'
      from jsonb_array_elements(coalesce(v_item -> 'intervals', '[]'::jsonb)) x
      on conflict do nothing;
    end if;
  end loop;

  select * into v_t from public.tenants where id = v_t.id;
  return v_report || jsonb_build_object('tenant_id', v_t.id, 'slug', v_t.slug, 'created', v_created,
                                        'status', v_t.status, 'config_version', v_t.config_version);
end $$;

-- Read-back for tenant:verify (service_role): compact fingerprint of DB state.
create or replace function public.pipeline_tenant_state(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare t public.tenants;
begin
  perform private.require_service_role();
  select * into t from public.tenants where slug = p_slug;
  if t.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'tenant', to_jsonb(t),
    'services', (select coalesce(jsonb_agg(jsonb_build_object('key', pipeline_key, 'name', name, 'price_cents', price_cents,
                   'duration_min', duration_min, 'is_active', is_active, 'managed_by', managed_by) order by sort_order), '[]')
                 from public.services where tenant_id = t.id),
    'barbers', (select coalesce(jsonb_agg(jsonb_build_object('key', b.pipeline_key, 'name', b.name, 'is_active', b.is_active,
                   'managed_by', b.managed_by, 'photo_path', b.photo_path,
                   'services', (select coalesce(jsonb_agg(s.pipeline_key order by s.pipeline_key), '[]') from public.barber_services bs
                                join public.services s on s.id = bs.service_id where bs.barber_id = b.id),
                   'weekly_intervals', (select count(*) from public.barber_weekly_hours h where h.barber_id = b.id))
                   order by b.sort_order), '[]') from public.barbers b where b.tenant_id = t.id),
    'photos', (select coalesce(jsonb_agg(jsonb_build_object('key', pipeline_key, 'path', storage_path, 'source', source)), '[]')
               from public.tenant_photos where tenant_id = t.id),
    'counts', jsonb_build_object(
      'bookings', (select count(*) from public.bookings where tenant_id = t.id),
      'customers', (select count(*) from public.customers where tenant_id = t.id),
      'members', (select count(*) from public.memberships where tenant_id = t.id)),
    'go_live_problems', to_jsonb(private.go_live_problems(t.id)));
end $$;

-- Membership management (service_role; users are created via Auth admin API).
create or replace function public.pipeline_set_member(p_slug text, p_user_id uuid, p_role text, p_barber_key text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.tenants; v_bid uuid;
begin
  perform private.require_service_role();
  select * into t from public.tenants where slug = p_slug;
  if t.id is null then
    perform private.fail('tenant_not_found');
  end if;
  if p_barber_key is not null then
    select id into v_bid from public.barbers where tenant_id = t.id and pipeline_key = p_barber_key;
    if v_bid is null then
      perform private.fail('barber_not_found');
    end if;
  end if;
  insert into public.memberships (tenant_id, user_id, role, barber_id)
  values (t.id, p_user_id, p_role, v_bid)
  on conflict (tenant_id, user_id) do update set role = excluded.role, barber_id = excluded.barber_id;
end $$;

-- Demo bookings for preview tenants (relative to "today" in tenant tz).
-- p_items: [{day_offset, time "HH:MM", service, barber|null, customer{name,phone,email}, status?}]
create or replace function public.pipeline_seed_demo_bookings(p_slug text, p_items jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare
  t public.tenants;
  v_item jsonb;
  v_n int := 0;
  v_cust uuid;
  v_sid uuid;
  v_bid uuid;
  v_start timestamptz;
  v_id uuid;
  v_idem uuid;
begin
  perform private.require_service_role();
  select * into t from public.tenants where slug = p_slug;
  if t.id is null or t.status <> 'preview' then
    perform private.fail('invalid_input', 'demo bookings only for preview tenants');
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    select id into v_sid from public.services where tenant_id = t.id and pipeline_key = v_item ->> 'service';
    v_bid := (select id from public.barbers where tenant_id = t.id and pipeline_key = v_item ->> 'barber');
    v_start := private.local_ts(private.local_today(t.timezone) + (v_item ->> 'day_offset')::int,
                                split_part(v_item ->> 'time', ':', 1)::int * 60 + split_part(v_item ->> 'time', ':', 2)::int,
                                t.timezone);
    v_idem := gen_random_uuid();
    v_cust := private.upsert_customer(t.id, v_item #>> '{customer,name}', v_item #>> '{customer,phone}',
                                      v_item #>> '{customer,email}', true);
    begin
      v_id := private.do_create_booking(t.id, v_sid, v_bid, v_start, v_cust, 'seed', null, true, v_idem,
                                        'seed', true, 'demo');
    exception when sqlstate 'P0001' then
      continue; -- slot not available today (e.g. weekday off): skip silently
    end;
    if v_item ->> 'status' = 'completed' and v_start < now() then
      update public.bookings set status = 'completed', completed_at = now() where id = v_id;
      insert into public.payments (tenant_id, booking_id, kind, amount_cents, currency, method, idempotency_key)
      select t.id, v_id, 'payment', snap_price_cents, snap_currency, 'card', gen_random_uuid()
      from public.bookings where id = v_id and snap_price_cents > 0;
    elsif v_item ->> 'status' = 'cancelled' then
      perform private.do_cancel_booking(v_id, 'client', null, 'demo');
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Create the tenant row if missing (first publish needs the id for storage paths).
create or replace function public.pipeline_ensure_tenant(
  p_slug text, p_name text, p_short_name text, p_timezone text, p_currency text,
  p_accent text, p_locale text, p_is_demo boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.require_service_role();
  select id into v_id from public.tenants where slug = p_slug;
  if v_id is null then
    insert into public.tenants (slug, name, short_name, timezone, currency, accent_color, locale, is_demo, status)
    values (p_slug, p_name, p_short_name, p_timezone, p_currency, p_accent, p_locale, p_is_demo, 'preview')
    returning id into v_id;
  end if;
  return v_id;
end $$;
