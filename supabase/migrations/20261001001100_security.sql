-- RLS, GRANTs and Storage policies.
-- Principle: anon has NO table privileges at all (only whitelisted RPCs).
-- authenticated may SELECT tenant data it is a member of (defense in depth);
-- every write goes through SECURITY DEFINER RPCs that check membership.
-- service_role bypasses RLS but only gets what the server functions need.

-- 1. Enable RLS everywhere ----------------------------------------------------------
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end $$;

-- 2. Revoke everything Supabase grants by default ---------------------------------
revoke all on all tables in schema public from anon, authenticated, public;
revoke all on all sequences in schema public from anon, authenticated, public;
revoke all on all functions in schema public from anon, authenticated, public;
revoke all on all tables in schema private from anon, authenticated, service_role, public;
revoke all on all functions in schema private from anon, authenticated, service_role, public;

-- 3. Membership-scoped read policies for authenticated ----------------------------
grant select on public.tenants, public.opening_hours, public.barbers, public.services,
  public.barber_services, public.barber_weekly_hours, public.barber_weekly_breaks,
  public.schedule_overrides, public.time_blocks, public.tenant_photos, public.memberships,
  public.customers, public.bookings, public.booking_events, public.payments
  to authenticated;

create policy tenants_member_read on public.tenants for select to authenticated
  using (private.has_role(id, array['owner', 'admin', 'barber']));

do $$
declare t text;
begin
  foreach t in array array['opening_hours', 'barbers', 'services', 'barber_services', 'barber_weekly_hours',
                           'barber_weekly_breaks', 'schedule_overrides', 'tenant_photos'] loop
    execute format($f$create policy %I on public.%I for select to authenticated
                     using (private.has_role(tenant_id, array['owner', 'admin', 'barber']))$f$,
                   t || '_member_read', t);
  end loop;
end $$;

create policy memberships_self_or_owner on public.memberships for select to authenticated
  using (user_id = auth.uid() or private.has_role(tenant_id, array['owner']));

create policy time_blocks_read on public.time_blocks for select to authenticated
  using (private.has_role(tenant_id, array['owner', 'admin'])
         or (private.has_role(tenant_id, array['barber'])
             and (barber_id is null or barber_id = private.my_barber_id(tenant_id))));

-- Barbers only see their own bookings / customers; payments are owner/admin only.
create policy bookings_read on public.bookings for select to authenticated
  using (private.has_role(tenant_id, array['owner', 'admin'])
         or (private.has_role(tenant_id, array['barber']) and barber_id = private.my_barber_id(tenant_id)));

create policy booking_events_read on public.booking_events for select to authenticated
  using (private.has_role(tenant_id, array['owner', 'admin'])
         or exists (select 1 from public.bookings b where b.id = booking_id
                    and b.barber_id = private.my_barber_id(b.tenant_id)));

create policy customers_read on public.customers for select to authenticated
  using (private.has_role(tenant_id, array['owner', 'admin'])
         or exists (select 1 from public.bookings b where b.customer_id = id
                    and b.barber_id = private.my_barber_id(b.tenant_id)));

create policy payments_read on public.payments for select to authenticated
  using (private.has_role(tenant_id, array['owner', 'admin']));

-- Never readable through the API by anyone but service_role:
--   resource_occupancies, idempotency_records, notification_jobs,
--   notification_deliveries, push_subscriptions (RLS on, no policies, no grants).
-- bookings.token_hash / request_hash / idempotency_key are hidden by column grants:
revoke select on public.bookings from authenticated;
grant select (id, tenant_id, customer_id, barber_id, service_id, starts_at, ends_at, occupied_until, status,
              source, is_demo, version, reschedule_count, snap_service_name, snap_duration_min, snap_buffer_min,
              snap_price_cents, snap_currency, snap_tenant_name, snap_timezone, snap_policy, snap_barber_name,
              snap_customer_name, snap_customer_phone, snap_customer_email, internal_note, created_by, created_at,
              updated_at, cancelled_at, cancelled_by, cancel_reason, completed_at)
  on public.bookings to authenticated;

-- 4. service_role: full table access for server-side tooling -------------------------
grant all on all tables in schema public to service_role;
grant usage on all sequences in schema public to service_role;

-- 5. Function grants (whitelist) -------------------------------------------------------
grant execute on function
  public.get_tenant_public(text),
  public.get_available_slots(text, uuid, uuid, date),
  public.get_available_dates(text, uuid, uuid, date, int),
  public.get_barbers_on_date(text, date),
  public.create_booking(text, uuid, uuid, timestamptz, jsonb, uuid),
  public.get_booking_by_token(text, text),
  public.cancel_booking_by_token(text, text, text),
  public.reschedule_booking_by_token(text, timestamptz, uuid, boolean, uuid, text),
  public.register_customer_push(text, jsonb, text, text),
  public.unregister_customer_push(text, text)
to anon, authenticated, service_role;

grant execute on function
  public.owner_my_tenants(),
  public.owner_workspace(uuid),
  public.owner_calendar(uuid, date, date, uuid),
  public.owner_create_booking(uuid, uuid, uuid, timestamptz, jsonb, text, boolean, uuid),
  public.owner_reschedule_booking(uuid, uuid, timestamptz, uuid, boolean, uuid),
  public.owner_cancel_booking(uuid, uuid, text),
  public.owner_set_booking_status(uuid, uuid, text),
  public.owner_update_booking_note(uuid, uuid, text),
  public.owner_booking_access_token(uuid, uuid),
  public.owner_booking_details(uuid, uuid),
  public.owner_record_payment(uuid, uuid, int, text, text, text, uuid),
  public.owner_upsert_barber(uuid, jsonb),
  public.owner_set_barber_services(uuid, uuid, uuid[]),
  public.owner_set_barber_schedule(uuid, uuid, jsonb, jsonb),
  public.owner_set_override(uuid, uuid, date, jsonb, text),
  public.owner_delete_override(uuid, uuid, date),
  public.owner_create_block(uuid, uuid, timestamptz, timestamptz, text, text),
  public.owner_delete_block(uuid, uuid),
  public.owner_upsert_service(uuid, jsonb),
  public.owner_list_customers(uuid, text, int),
  public.owner_get_customer(uuid, uuid),
  public.owner_update_customer(uuid, uuid, jsonb),
  public.owner_update_settings(uuid, jsonb),
  public.owner_set_opening_hours(uuid, jsonb),
  public.owner_add_photo(uuid, text, text, text),
  public.owner_update_photo(uuid, uuid, jsonb),
  public.owner_delete_photo(uuid, uuid),
  public.owner_register_push(uuid, jsonb, text),
  public.owner_unregister_push(uuid, text),
  public.owner_go_live(uuid),
  public.owner_go_live_check(uuid),
  public.owner_stats(uuid, date, date, uuid, uuid),
  public.owner_membership(uuid),
  public.ai_usage(uuid)
to authenticated, service_role;

grant execute on function
  public.worker_claim_notifications(text, int, int),
  public.worker_complete_notification(uuid, text, jsonb, text),
  public.worker_maintenance(),
  public.ai_reserve(uuid, int, int, bigint, text),
  public.ai_commit_usage(uuid, date, int),
  public.pipeline_publish_tenant(jsonb, boolean, boolean),
  public.pipeline_ensure_tenant(text, text, text, text, text, text, text, boolean),
  public.pipeline_tenant_state(text),
  public.pipeline_set_member(text, uuid, text, text),
  public.pipeline_seed_demo_bookings(text, jsonb)
to service_role;

-- 6. Storage: one public-read bucket for tenant media; writes only by
--    owner/admin of the tenant whose id is the first path segment.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tenant-media', 'tenant-media', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function private.storage_tenant_id(p_name text)
returns uuid language plpgsql immutable as $$
begin
  return (storage.foldername(p_name))[1]::uuid;
exception when others then
  return null;
end $$;
grant usage on schema private to authenticated;
grant execute on function private.storage_tenant_id(text), private.has_role(uuid, text[]),
  private.my_barber_id(uuid) to authenticated;

drop policy if exists tenant_media_select on storage.objects;
drop policy if exists tenant_media_insert on storage.objects;
drop policy if exists tenant_media_update on storage.objects;
drop policy if exists tenant_media_delete on storage.objects;

-- Listing/upsert needs SELECT; public files are served by the public URL anyway.
create policy tenant_media_select on storage.objects for select to authenticated
  using (bucket_id = 'tenant-media'
         and private.has_role(private.storage_tenant_id(name), array['owner', 'admin']));
create policy tenant_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'tenant-media'
              and private.has_role(private.storage_tenant_id(name), array['owner', 'admin'])
              and (storage.foldername(name))[2] = 'owner');
create policy tenant_media_update on storage.objects for update to authenticated
  using (bucket_id = 'tenant-media'
         and private.has_role(private.storage_tenant_id(name), array['owner', 'admin'])
         and (storage.foldername(name))[2] = 'owner');
create policy tenant_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'tenant-media'
         and private.has_role(private.storage_tenant_id(name), array['owner', 'admin'])
         and (storage.foldername(name))[2] = 'owner');
