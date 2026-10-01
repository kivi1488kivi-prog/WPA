-- Schedules, blocks, customers, bookings and the single occupancy table that
-- makes double booking impossible at the database level.

-- Weekly template: several intervals per weekday are allowed (no overlaps).
create table public.barber_weekly_hours (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  barber_id uuid not null,
  weekday smallint not null check (weekday between 1 and 7), -- ISO: 1 = Monday
  start_min int not null check (start_min between 0 and 1439),
  end_min int not null check (end_min between 1 and 1440),
  check (start_min < end_min),
  foreign key (tenant_id, barber_id) references public.barbers(tenant_id, id) on delete cascade,
  exclude using gist (barber_id with =, weekday with =, int4range(start_min, end_min) with &&)
);
create index on public.barber_weekly_hours (tenant_id, barber_id);

-- Weekly recurring breaks (lunch etc.), subtracted from the template.
create table public.barber_weekly_breaks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  barber_id uuid not null,
  weekday smallint not null check (weekday between 1 and 7),
  start_min int not null check (start_min between 0 and 1439),
  end_min int not null check (end_min between 1 and 1440),
  label text not null default '' check (length(label) <= 60),
  check (start_min < end_min),
  foreign key (tenant_id, barber_id) references public.barbers(tenant_id, id) on delete cascade,
  exclude using gist (barber_id with =, weekday with =, int4range(start_min, end_min) with &&)
);
create index on public.barber_weekly_breaks (tenant_id, barber_id);

-- Special dates. barber_id NULL = whole shop.
--  * barber override: replaces that barber's weekly template (and breaks) for the date;
--  * shop override: intersects every barber's hours for the date.
-- A row with NULL start/end means "closed all day".
create table public.schedule_overrides (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  barber_id uuid,
  on_date date not null,
  start_min int check (start_min between 0 and 1439),
  end_min int check (end_min between 1 and 1440),
  note text not null default '' check (length(note) <= 200),
  source text not null default 'owner' check (source in ('pipeline', 'owner')),
  created_at timestamptz not null default now(),
  check ((start_min is null) = (end_min is null)),
  check (start_min is null or start_min < end_min),
  foreign key (tenant_id, barber_id) references public.barbers(tenant_id, id) on delete cascade,
  exclude using gist (
    tenant_id with =,
    (coalesce(barber_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    on_date with =,
    int4range(coalesce(start_min, 0), coalesce(end_min, 1440)) with &&
  )
);
create index on public.schedule_overrides (tenant_id, on_date);

-- Time blocks: vacation, technical break, sanitary day, private event, day off.
-- barber_id NULL = whole shop (materialized as one occupancy per barber).
create table public.time_blocks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  barber_id uuid,
  during tstzrange not null check (not isempty(during) and lower_inc(during) and not upper_inc(during)
                                   and not lower_inf(during) and not upper_inf(during)),
  kind text not null check (kind in ('vacation', 'break', 'sanitary', 'event', 'day_off', 'other')),
  note text not null default '' check (length(note) <= 200),
  created_by uuid,
  created_at timestamptz not null default now(),
  check (upper(during) - lower(during) <= interval '400 days'),
  unique (tenant_id, id),
  foreign key (tenant_id, barber_id) references public.barbers(tenant_id, id) on delete cascade
);
create index on public.time_blocks (tenant_id);
create index on public.time_blocks using gist (tenant_id, during);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  phone text not null,
  phone_normalized text not null,
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  internal_note text not null default '' check (length(internal_note) <= 2000),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, phone_normalized)
);
create trigger customers_touch before update on public.customers
  for each row execute function private.touch_updated_at();

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null,
  barber_id uuid not null,
  service_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  occupied_until timestamptz not null,
  status text not null default 'confirmed'
    check (status in ('confirmed', 'cancelled', 'completed', 'no_show')),
  source text not null check (source in ('client', 'owner', 'ai', 'seed')),
  is_demo boolean not null default false,
  version int not null default 1,
  reschedule_count int not null default 0,
  -- immutable snapshots taken at booking time
  snap_service_name text not null,
  snap_duration_min int not null,
  snap_buffer_min int not null,
  snap_price_cents int not null,
  snap_currency text not null,
  snap_tenant_name text not null,
  snap_timezone text not null,
  snap_policy jsonb not null,
  -- barber snapshot follows the assignment (updated only together with barber_id)
  snap_barber_name text not null,
  snap_customer_name text not null,
  snap_customer_phone text not null,
  snap_customer_email text,
  internal_note text not null default '' check (length(internal_note) <= 2000),
  idempotency_key uuid,
  request_hash text,
  token_hash bytea unique,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by text check (cancelled_by in ('client', 'staff', 'system')),
  cancel_reason text check (length(cancel_reason) <= 500),
  completed_at timestamptz,
  check (ends_at > starts_at),
  check (occupied_until >= ends_at),
  check ((status = 'cancelled') = (cancelled_at is not null)),
  unique (tenant_id, id),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, customer_id) references public.customers(tenant_id, id) on delete restrict,
  foreign key (tenant_id, barber_id) references public.barbers(tenant_id, id) on delete restrict,
  foreign key (tenant_id, service_id) references public.services(tenant_id, id) on delete restrict
);
create index on public.bookings (tenant_id, starts_at);
create index on public.bookings (tenant_id, barber_id, starts_at);
create index on public.bookings (tenant_id, customer_id, starts_at);
create trigger bookings_touch before update on public.bookings
  for each row execute function private.touch_updated_at();

-- Historical facts must not change after the fact.
create or replace function private.bookings_guard_snapshots()
returns trigger language plpgsql as $$
begin
  if new.tenant_id <> old.tenant_id
     or new.customer_id <> old.customer_id
     or new.service_id <> old.service_id
     or new.created_at <> old.created_at
     or new.source <> old.source
     or new.snap_service_name <> old.snap_service_name
     or new.snap_duration_min <> old.snap_duration_min
     or new.snap_buffer_min <> old.snap_buffer_min
     or new.snap_price_cents <> old.snap_price_cents
     or new.snap_currency <> old.snap_currency
     or new.snap_tenant_name <> old.snap_tenant_name
     or new.snap_timezone <> old.snap_timezone
     or new.snap_policy <> old.snap_policy
     or new.snap_customer_name <> old.snap_customer_name
     or new.snap_customer_phone <> old.snap_customer_phone
     or new.snap_customer_email is distinct from old.snap_customer_email
     or new.token_hash is distinct from old.token_hash
     or new.idempotency_key is distinct from old.idempotency_key
     or (new.snap_barber_name <> old.snap_barber_name and new.barber_id = old.barber_id)
  then
    perform private.fail('immutable_snapshot', 'booking history fields are immutable');
  end if;
  if old.status in ('cancelled') and new.status <> old.status then
    perform private.fail('invalid_transition', 'cancelled booking cannot be revived');
  end if;
  return new;
end $$;
create trigger bookings_guard before update on public.bookings
  for each row execute function private.bookings_guard_snapshots();

-- THE resource table: bookings and blocks share it, the EXCLUDE constraint
-- guarantees one barber is never occupied twice at the same instant.
create table public.resource_occupancies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  barber_id uuid not null,
  during tstzrange not null check (not isempty(during) and lower_inc(during) and not upper_inc(during)),
  kind text not null check (kind in ('booking', 'block')),
  booking_id uuid,
  block_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check ((kind = 'booking') = (booking_id is not null)),
  check ((kind = 'block') = (block_id is not null)),
  foreign key (tenant_id, barber_id) references public.barbers(tenant_id, id) on delete cascade,
  foreign key (tenant_id, booking_id) references public.bookings(tenant_id, id) on delete cascade,
  foreign key (tenant_id, block_id) references public.time_blocks(tenant_id, id) on delete cascade,
  constraint resource_occupancies_no_overlap
    exclude using gist (barber_id with =, during with &&) where (active)
);
create unique index resource_occupancies_one_active_per_booking
  on public.resource_occupancies (booking_id) where active and kind = 'booking';
create index on public.resource_occupancies (tenant_id, barber_id);
create index on public.resource_occupancies (block_id);

create table public.booking_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  booking_id uuid not null,
  at timestamptz not null default now(),
  type text not null check (type in ('created', 'rescheduled', 'cancelled', 'completed', 'no_show', 'note')),
  actor text not null,
  data jsonb not null default '{}'::jsonb,
  foreign key (tenant_id, booking_id) references public.bookings(tenant_id, id) on delete cascade
);
create index on public.booking_events (tenant_id, booking_id, at);

-- Money actually received. Append-only: refunds are separate negative facts.
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  booking_id uuid not null,
  kind text not null check (kind in ('payment', 'refund')),
  amount_cents int not null check (amount_cents > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  method text not null check (method in ('cash', 'card', 'transfer', 'online', 'other')),
  paid_at timestamptz not null default now(),
  note text not null default '' check (length(note) <= 300),
  recorded_by uuid,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, booking_id) references public.bookings(tenant_id, id) on delete restrict
);
create index on public.payments (tenant_id, paid_at);

create or replace function private.payments_append_only()
returns trigger language plpgsql as $$
begin
  -- Only the explicit demo purge on go-live may delete (demo rows only).
  if tg_op = 'DELETE' and current_setting('app.purge_demo', true) = 'on' then
    return old;
  end if;
  perform private.fail('immutable_payment', 'payments are append-only; record a refund instead');
  return null;
end $$;
create trigger payments_no_update before update or delete on public.payments
  for each row execute function private.payments_append_only();

-- Generic idempotency ledger for reschedule/cancel/payment operations.
create table public.idempotency_records (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  scope text not null,
  key uuid not null,
  request_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, scope, key)
);
