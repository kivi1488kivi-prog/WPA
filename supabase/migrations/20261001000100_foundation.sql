-- Foundation: extensions, private schema, secrets, generic helpers.
-- All business functions live in `public` (API surface, explicitly granted)
-- or `private` (never exposed through the Data API).

create extension if not exists btree_gist with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
-- service_role needs nothing in private: every entry point is a public
-- SECURITY DEFINER function owned by the migration role.

-- Server-side secrets (HMAC key for booking access tokens). Never granted.
create table private.app_secrets (
  name text primary key,
  value bytea not null,
  created_at timestamptz not null default now()
);
revoke all on private.app_secrets from public;

insert into private.app_secrets (name, value)
values ('booking_token_key', extensions.gen_random_bytes(32))
on conflict (name) do nothing;

-- Error helper: every domain error is raised with a stable machine code in
-- MESSAGE and a human hint; the frontend maps codes to localized texts.
create or replace function private.fail(p_code text, p_detail text default null)
returns void language plpgsql as $$
begin
  raise exception using errcode = 'P0001', message = p_code, detail = coalesce(p_detail, '');
end $$;

create or replace function private.is_valid_timezone(p_tz text)
returns boolean language plpgsql immutable as $$
begin
  if p_tz is null or p_tz = '' then return false; end if;
  perform now() at time zone p_tz;
  return exists (select 1 from pg_catalog.pg_timezone_names where name = p_tz);
exception when others then
  return false;
end $$;

-- Local wall-clock (date + minutes since midnight) in a tenant timezone -> instant.
create or replace function private.local_ts(p_date date, p_min int, p_tz text)
returns timestamptz language sql immutable as $$
  select ((p_date::timestamp + make_interval(mins => p_min)) at time zone p_tz)
$$;

create or replace function private.base64url(p bytea)
returns text language sql immutable as $$
  select translate(rtrim(encode(p, 'base64'), '='), E'+/\n', '-_')
$$;

create or replace function private.sha256_hex(p text)
returns text language sql immutable as $$
  select encode(extensions.digest(convert_to(p, 'UTF8'), 'sha256'), 'hex')
$$;

create or replace function private.token_hash(p_token text)
returns bytea language sql immutable as $$
  select extensions.digest(convert_to(coalesce(p_token, ''), 'UTF8'), 'sha256')
$$;

-- Client IP as forwarded by the API gateway (PostgREST exposes request.headers).
create or replace function private.client_ip()
returns text language sql stable as $$
  select coalesce(
    nullif(split_part(coalesce(
      (nullif(current_setting('request.headers', true), '')::json ->> 'cf-connecting-ip'),
      (nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for'),
      (nullif(current_setting('request.headers', true), '')::json ->> 'x-real-ip'),
      ''), ',', 1), ''),
    'unknown')
$$;

create or replace function private.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Phone normalization: keep leading +, digits only, 7..15 digits (E.164 length).
create or replace function private.normalize_phone(p text)
returns text language plpgsql immutable as $$
declare d text;
begin
  if p is null then return null; end if;
  d := regexp_replace(p, '[^0-9]', '', 'g');
  if length(d) < 7 or length(d) > 15 then return null; end if;
  if left(btrim(p), 1) = '+' then return '+' || d; end if;
  if left(d, 2) = '00' then return '+' || substr(d, 3); end if;
  return d;
end $$;

-- Lock down: no function in schema public is executable by default.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke all on functions from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
