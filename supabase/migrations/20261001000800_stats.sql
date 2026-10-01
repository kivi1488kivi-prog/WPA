-- Statistics are computed in SQL only. The period is a pair of LOCAL dates
-- interpreted in the tenant timezone; the same function serves UI and AI.
-- Vocabulary (kept strictly apart):
--   upcoming_*      future confirmed bookings (expected value, NOT revenue)
--   awaiting_close  past confirmed bookings not yet marked completed/no-show
--   completed_*     visits that actually happened (booked value)
--   received_cents  money actually received (payments - refunds) by paid_at

create or replace function private.stats(
  p_tenant_id uuid, p_from date, p_to date, p_barber_id uuid, p_service_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  t public.tenants;
  v_from_ts timestamptz;
  v_to_ts timestamptz;
begin
  select * into t from public.tenants where id = p_tenant_id;
  if p_to < p_from or p_to - p_from > 366 then
    perform private.fail('invalid_input', 'period');
  end if;
  v_from_ts := private.local_ts(p_from, 0, t.timezone);
  v_to_ts := private.local_ts(p_to + 1, 0, t.timezone);

  return (
    with bk as (
      select b.* from public.bookings b
      where b.tenant_id = p_tenant_id and b.starts_at >= v_from_ts and b.starts_at < v_to_ts
        and (p_barber_id is null or b.barber_id = p_barber_id)
        and (p_service_id is null or b.service_id = p_service_id)
    ), pay as (
      select p.*, b.barber_id, b.service_id, b.snap_service_name, b.snap_barber_name
      from public.payments p join public.bookings b on b.id = p.booking_id
      where p.tenant_id = p_tenant_id and p.paid_at >= v_from_ts and p.paid_at < v_to_ts
        and (p_barber_id is null or b.barber_id = p_barber_id)
        and (p_service_id is null or b.service_id = p_service_id)
    )
    select jsonb_build_object(
      'period', jsonb_build_object('from', p_from, 'to', p_to, 'timezone', t.timezone,
                                   'from_ts', v_from_ts, 'to_ts', v_to_ts),
      'filters', jsonb_build_object('barber_id', p_barber_id, 'service_id', p_service_id),
      'currency', t.currency,
      'totals', jsonb_build_object(
        'bookings_total', (select count(*) from bk),
        'upcoming_count', (select count(*) from bk where status = 'confirmed' and starts_at >= now()),
        'upcoming_value_cents', (select coalesce(sum(snap_price_cents), 0) from bk where status = 'confirmed' and starts_at >= now()),
        'awaiting_close_count', (select count(*) from bk where status = 'confirmed' and starts_at < now()),
        'completed_count', (select count(*) from bk where status = 'completed'),
        'completed_value_cents', (select coalesce(sum(snap_price_cents), 0) from bk where status = 'completed'),
        'cancelled_count', (select count(*) from bk where status = 'cancelled'),
        'cancelled_by_client', (select count(*) from bk where status = 'cancelled' and cancelled_by = 'client'),
        'cancelled_by_staff', (select count(*) from bk where status = 'cancelled' and cancelled_by in ('staff', 'system')),
        'no_show_count', (select count(*) from bk where status = 'no_show'),
        'received_cents', (select coalesce(sum(case when kind = 'payment' then amount_cents else -amount_cents end), 0) from pay),
        'refunded_cents', (select coalesce(sum(amount_cents), 0) from pay where kind = 'refund'),
        'unique_customers', (select count(distinct customer_id) from bk where status in ('completed', 'confirmed'))),
      'by_barber', coalesce((
        select jsonb_agg(x order by x ->> 'name') from (
          select jsonb_build_object(
            'barber_id', br.id, 'name', br.name, 'is_active', br.is_active,
            'completed_count', (select count(*) from bk where bk.barber_id = br.id and status = 'completed'),
            'upcoming_count', (select count(*) from bk where bk.barber_id = br.id and status = 'confirmed' and starts_at >= now()),
            'cancelled_count', (select count(*) from bk where bk.barber_id = br.id and status = 'cancelled'),
            'no_show_count', (select count(*) from bk where bk.barber_id = br.id and status = 'no_show'),
            'received_cents', (select coalesce(sum(case when kind = 'payment' then amount_cents else -amount_cents end), 0)
                               from pay where pay.barber_id = br.id)) as x
          from public.barbers br
          where br.tenant_id = p_tenant_id and (p_barber_id is null or br.id = p_barber_id)
            and (br.is_active or exists (select 1 from bk where bk.barber_id = br.id))) s), '[]'::jsonb),
      'by_service', coalesce((
        select jsonb_agg(x order by x ->> 'name') from (
          select jsonb_build_object(
            'service_id', sv.id, 'name', sv.name,
            'completed_count', (select count(*) from bk where bk.service_id = sv.id and status = 'completed'),
            'upcoming_count', (select count(*) from bk where bk.service_id = sv.id and status = 'confirmed' and starts_at >= now()),
            'cancelled_count', (select count(*) from bk where bk.service_id = sv.id and status = 'cancelled'),
            'received_cents', (select coalesce(sum(case when kind = 'payment' then amount_cents else -amount_cents end), 0)
                               from pay where pay.service_id = sv.id)) as x
          from public.services sv
          where sv.tenant_id = p_tenant_id and (p_service_id is null or sv.id = p_service_id)
            and (sv.is_active or exists (select 1 from bk where bk.service_id = sv.id))) s), '[]'::jsonb),
      'daily', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'date', d.d::date,
                 'booked_count', (select count(*) from bk where status <> 'cancelled'
                                    and (starts_at at time zone t.timezone)::date = d.d::date),
                 'completed_count', (select count(*) from bk where status = 'completed'
                                       and (starts_at at time zone t.timezone)::date = d.d::date),
                 'cancelled_count', (select count(*) from bk where status = 'cancelled'
                                       and (starts_at at time zone t.timezone)::date = d.d::date),
                 'received_cents', (select coalesce(sum(case when kind = 'payment' then amount_cents else -amount_cents end), 0)
                                    from pay where (paid_at at time zone t.timezone)::date = d.d::date))
               order by d.d)
        from generate_series(p_from, p_to, interval '1 day') d(d)), '[]'::jsonb)
    ));
end $$;

create or replace function public.owner_stats(
  p_tenant_id uuid, p_from date, p_to date, p_barber_id uuid default null, p_service_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare m public.memberships;
begin
  m := private.require_member(p_tenant_id, array['owner', 'admin', 'barber']);
  if m.role = 'barber' then
    return private.stats(p_tenant_id, p_from, p_to, m.barber_id, p_service_id);
  end if;
  return private.stats(p_tenant_id, p_from, p_to, p_barber_id, p_service_id);
end $$;
