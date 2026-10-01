-- GDPR (DSGVO) support: access/portability export (Art. 15/20), erasure by
-- anonymization (Art. 17) and automatic retention. Financial facts (payments,
-- prices, dates) are kept for statutory bookkeeping periods, but without
-- personal identifiers.

create or replace function private.anonymize_customer(p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  v_bookings int;
begin
  select * into c from public.customers where id = p_customer_id for update;
  if c.id is null then
    perform private.fail('customer_not_found');
  end if;
  if c.anonymized_at is not null then
    return jsonb_build_object('customer_id', c.id, 'already', true);
  end if;
  perform set_config('app.anonymize', 'on', true);
  update public.bookings
     set snap_customer_name = '—', snap_customer_phone = '—', snap_customer_email = null,
         internal_note = '', cancel_reason = null
   where customer_id = c.id;
  get diagnostics v_bookings = row_count;
  perform set_config('app.anonymize', 'off', true);
  update public.booking_events set data = data - 'reason' where booking_id in (select id from public.bookings where customer_id = c.id);
  delete from public.push_subscriptions where booking_id in (select id from public.bookings where customer_id = c.id);
  update public.customers
     set name = '—', phone = '—', phone_normalized = 'anon:' || c.id::text, email = null,
         internal_note = '', anonymized_at = now()
   where id = c.id;
  return jsonb_build_object('customer_id', c.id, 'bookings_anonymized', v_bookings, 'already', false);
end $$;

create or replace function public.owner_anonymize_customer(p_tenant_id uuid, p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_member(p_tenant_id, array['owner']);
  if not exists (select 1 from public.customers where id = p_customer_id and tenant_id = p_tenant_id) then
    perform private.fail('customer_not_found');
  end if;
  if exists (select 1 from public.bookings where customer_id = p_customer_id and status = 'confirmed' and starts_at > now()) then
    perform private.fail('invalid_transition', 'customer_has_upcoming_bookings');
  end if;
  return private.anonymize_customer(p_customer_id);
end $$;

-- Machine-readable export of everything stored about one customer.
create or replace function public.owner_export_customer(p_tenant_id uuid, p_customer_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.customers; t public.tenants;
begin
  perform private.require_member(p_tenant_id, array['owner', 'admin']);
  select * into c from public.customers where id = p_customer_id and tenant_id = p_tenant_id;
  if c.id is null then
    perform private.fail('customer_not_found');
  end if;
  select * into t from public.tenants where id = p_tenant_id;
  return jsonb_build_object(
    'exported_at', now(),
    'controller', jsonb_build_object('name', coalesce(t.legal #>> '{impressum,legal_name}', t.name),
                                     'email', coalesce(t.legal #>> '{impressum,email}', t.email)),
    'customer', jsonb_build_object('name', c.name, 'phone', c.phone, 'email', c.email, 'created_at', c.created_at,
                                   'internal_note', c.internal_note, 'anonymized_at', c.anonymized_at),
    'bookings', coalesce((select jsonb_agg(jsonb_build_object(
                  'starts_at', b.starts_at, 'ends_at', b.ends_at, 'status', b.status, 'service', b.snap_service_name,
                  'barber', b.snap_barber_name, 'price_cents', b.snap_price_cents, 'currency', b.snap_currency,
                  'source', b.source, 'created_at', b.created_at, 'cancelled_at', b.cancelled_at,
                  'cancel_reason', b.cancel_reason, 'internal_note', b.internal_note) order by b.starts_at)
                 from public.bookings b where b.customer_id = c.id), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('kind', p.kind, 'amount_cents', p.amount_cents,
                  'currency', p.currency, 'method', p.method, 'paid_at', p.paid_at) order by p.paid_at)
                 from public.payments p join public.bookings b on b.id = p.booking_id where b.customer_id = c.id), '[]'::jsonb),
    'push_subscriptions', (select count(*) from public.push_subscriptions ps
                           join public.bookings b on b.id = ps.booking_id where b.customer_id = c.id and ps.disabled_at is null));
end $$;

-- Retention job (Supabase Cron / notify-worker): anonymize customers whose
-- last visit is older than the tenant retention period; purge stale outbox rows.
create or replace function public.worker_retention()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_c record;
  v_n int := 0;
begin
  perform private.require_service_role();
  for v_c in
    select c.id from public.customers c join public.tenants t on t.id = c.tenant_id
    where c.anonymized_at is null
      and not exists (select 1 from public.bookings b where b.customer_id = c.id
                      and b.starts_at > now() - make_interval(months => t.retention_months))
      and c.created_at < now() - make_interval(months => t.retention_months)
    limit 500
  loop
    perform private.anonymize_customer(v_c.id);
    v_n := v_n + 1;
  end loop;
  delete from public.notification_jobs where status in ('sent', 'failed', 'cancelled', 'skipped') and updated_at < now() - interval '90 days';
  delete from public.push_subscriptions where disabled_at < now() - interval '30 days';
  return jsonb_build_object('customers_anonymized', v_n);
end $$;

revoke all on function public.owner_anonymize_customer(uuid, uuid), public.owner_export_customer(uuid, uuid),
  public.worker_retention() from public, anon, authenticated;
revoke all on function private.anonymize_customer(uuid) from public, anon, authenticated;
grant execute on function public.owner_anonymize_customer(uuid, uuid), public.owner_export_customer(uuid, uuid)
  to authenticated, service_role;
grant execute on function public.worker_retention() to service_role;
