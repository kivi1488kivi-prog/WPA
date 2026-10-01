-- Outbox for notifications, push subscriptions, shared atomic counters for
-- public rate limits and LLM budget.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  audience text not null check (audience in ('customer', 'staff')),
  booking_id uuid,
  user_id uuid references auth.users(id) on delete cascade,
  endpoint text not null check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh text not null check (length(p256dh) between 40 and 200),
  auth_secret text not null check (length(auth_secret) between 16 and 64),
  user_agent text check (length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  disabled_at timestamptz,
  check ((audience = 'customer') = (booking_id is not null)),
  check ((audience = 'staff') = (user_id is not null)),
  foreign key (tenant_id, booking_id) references public.bookings(tenant_id, id) on delete cascade
);
create unique index push_subscriptions_unique_target on public.push_subscriptions (
  tenant_id, endpoint,
  coalesce(booking_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid)
);
create index on public.push_subscriptions (booking_id) where disabled_at is null;
create index on public.push_subscriptions (tenant_id, audience) where disabled_at is null;

create table public.notification_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  booking_id uuid not null,
  booking_version int not null,
  audience text not null check (audience in ('customer', 'staff')),
  event text not null check (event in ('created', 'rescheduled', 'cancelled', 'reminder')),
  dedupe_key text not null unique,
  run_at timestamptz not null default now(),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed', 'cancelled', 'skipped')),
  status_reason text,
  attempts int not null default 0,
  max_attempts int not null default 5,
  lease_until timestamptz,
  leased_by text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (tenant_id, booking_id) references public.bookings(tenant_id, id) on delete cascade
);
create index notification_jobs_due on public.notification_jobs (run_at) where status in ('pending', 'processing');
create index on public.notification_jobs (booking_id);
create trigger notification_jobs_touch before update on public.notification_jobs
  for each row execute function private.touch_updated_at();

-- One row per (job, subscription): guarantees at-most-once delivery per device
-- even when a worker crashes and the job lease is taken over.
create table public.notification_deliveries (
  job_id uuid not null references public.notification_jobs(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'gone', 'failed', 'unknown')),
  http_status int,
  updated_at timestamptz not null default now(),
  primary key (job_id, subscription_id)
);

create table private.rate_counters (
  bucket text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (bucket, window_start)
);

-- Daily LLM usage. The all-zero uuid row is the global (all tenants) budget.
create table private.llm_usage (
  tenant_id uuid not null,
  day date not null,
  requests int not null default 0,
  tokens bigint not null default 0,
  primary key (day, tenant_id)
);

-- Atomic fixed-window counter. Returns true while under the limit.
create or replace function private.rate_hit(p_bucket text, p_limit int, p_window_sec int)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_sec) * p_window_sec);
  v_hits int;
begin
  insert into private.rate_counters as rc (bucket, window_start, hits)
  values (p_bucket, v_window, 1)
  on conflict (bucket, window_start) do update set hits = rc.hits + 1
  returning hits into v_hits;
  return v_hits <= p_limit;
end $$;

create or replace function private.enforce_rate(p_bucket text, p_limit int, p_window_sec int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.rate_hit(p_bucket, p_limit, p_window_sec) then
    perform private.fail('rate_limited', p_bucket);
  end if;
end $$;

create or replace function private.cleanup_counters()
returns void language sql security definer set search_path = '' as $$
  delete from private.rate_counters where window_start < now() - interval '2 days';
  delete from private.llm_usage where day < current_date - 90;
$$;
