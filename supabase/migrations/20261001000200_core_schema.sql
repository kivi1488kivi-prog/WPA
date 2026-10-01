-- Core multi-tenant schema. Every dependent row carries tenant_id and points to
-- its parents through composite (tenant_id, id) foreign keys, so a row can
-- never reference an entity of another tenant.

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  status text not null default 'preview' check (status in ('preview', 'live', 'suspended')),
  is_demo boolean not null default false,
  name text not null check (length(btrim(name)) between 1 and 80),
  short_name text not null check (length(btrim(short_name)) between 1 and 24),
  tagline text check (length(tagline) <= 140),
  description text check (length(description) <= 2000),
  timezone text not null check (private.is_valid_timezone(timezone)),
  locale text not null default 'de' check (locale in ('de', 'en', 'ru')),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  accent_color text not null check (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  phone text,
  email text,
  address_line text,
  city text,
  postal_code text,
  country text,
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  map_url text,
  instagram text,
  website text,
  -- Legal (Impressum § 5 DDG, privacy notice data, retention). Public data.
  legal jsonb not null default '{}'::jsonb check (jsonb_typeof(legal) = 'object'),
  retention_months int not null default 36 check (retention_months between 6 and 120),
  logo_path text,
  cover_path text,
  -- booking rules
  slot_step_min int not null default 15 check (slot_step_min in (5, 10, 15, 20, 30, 60)),
  min_lead_min int not null default 60 check (min_lead_min between 0 and 10080),
  max_advance_days int not null default 60 check (max_advance_days between 1 and 365),
  allow_self_cancel boolean not null default true,
  cancel_min_notice_min int not null default 120 check (cancel_min_notice_min between 0 and 20160),
  allow_self_reschedule boolean not null default true,
  reschedule_min_notice_min int not null default 120 check (reschedule_min_notice_min between 0 and 20160),
  max_self_reschedules int not null default 3 check (max_self_reschedules between 0 and 20),
  reminder_offsets_min int[] not null default '{1440,120}',
  notify_staff boolean not null default true,
  -- AI
  ai_enabled boolean not null default true,
  ai_daily_request_limit int not null default 300 check (ai_daily_request_limit between 0 and 100000),
  ai_daily_token_limit int not null default 300000 check (ai_daily_token_limit between 0 and 100000000),
  -- pipeline bookkeeping
  -- tenant-level sections the owner edited in the cabinet; the pipeline does
  -- not overwrite them on republish unless forced ('settings', 'opening_hours').
  owner_overrides text[] not null default '{}',
  config_version int not null default 0,
  config_hash text,
  published_at timestamptz,
  live_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger tenants_touch before update on public.tenants
  for each row execute function private.touch_updated_at();

create table public.opening_hours (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  start_min int not null check (start_min between 0 and 1439),
  end_min int not null check (end_min between 1 and 1440),
  check (start_min < end_min),
  exclude using gist (tenant_id with =, weekday with =, int4range(start_min, end_min) with &&)
);
create index on public.opening_hours (tenant_id);

create table public.barbers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  pipeline_key text check (pipeline_key ~ '^[a-z0-9][a-z0-9-]{0,40}$'),
  managed_by text not null default 'owner' check (managed_by in ('pipeline', 'owner')),
  name text not null check (length(btrim(name)) between 1 and 60),
  title text check (length(title) <= 60),
  bio text check (length(bio) <= 1000),
  photo_path text,
  photo_source text check (photo_source in ('pipeline', 'owner')),
  specialties text[] not null default '{}',
  color text not null default '#9CA3AF' check (color ~ '^#[0-9a-fA-F]{6}$'),
  marker text not null default '' check (length(marker) <= 3),
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, pipeline_key)
);
create trigger barbers_touch before update on public.barbers
  for each row execute function private.touch_updated_at();

create table public.services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  pipeline_key text check (pipeline_key ~ '^[a-z0-9][a-z0-9-]{0,40}$'),
  managed_by text not null default 'owner' check (managed_by in ('pipeline', 'owner')),
  name text not null check (length(btrim(name)) between 1 and 80),
  description text check (length(description) <= 1000),
  duration_min int not null check (duration_min between 5 and 480),
  buffer_min int not null default 0 check (buffer_min between 0 and 120),
  price_cents int not null check (price_cents between 0 and 100000000),
  is_active boolean not null default true,
  sort_order int not null default 0,
  -- optional per-service overrides of tenant policies (null = inherit)
  allow_self_cancel boolean,
  cancel_min_notice_min int check (cancel_min_notice_min between 0 and 20160),
  allow_self_reschedule boolean,
  reschedule_min_notice_min int check (reschedule_min_notice_min between 0 and 20160),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, pipeline_key)
);
create trigger services_touch before update on public.services
  for each row execute function private.touch_updated_at();

create table public.barber_services (
  tenant_id uuid not null,
  barber_id uuid not null,
  service_id uuid not null,
  primary key (barber_id, service_id),
  foreign key (tenant_id, barber_id) references public.barbers(tenant_id, id) on delete cascade,
  foreign key (tenant_id, service_id) references public.services(tenant_id, id) on delete cascade
);
create index on public.barber_services (tenant_id, service_id);

create table public.memberships (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'barber')),
  barber_id uuid,
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id),
  foreign key (tenant_id, barber_id) references public.barbers(tenant_id, id) on delete restrict,
  check (role <> 'barber' or barber_id is not null)
);
create index on public.memberships (user_id);

create table public.tenant_photos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('cover', 'interior', 'work')),
  storage_path text not null,
  alt text not null default '' check (length(alt) <= 200),
  sort_order int not null default 0,
  source text not null check (source in ('pipeline', 'owner')),
  pipeline_key text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, pipeline_key)
);
create index on public.tenant_photos (tenant_id, kind, sort_order);
