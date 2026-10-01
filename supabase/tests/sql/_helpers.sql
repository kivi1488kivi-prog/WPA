-- Test helpers (loaded once per test database; not a migration).
\set ON_ERROR_STOP on
create schema if not exists tests;
grant usage on schema tests to anon, authenticated, service_role;

create or replace function tests.ok(p_cond boolean, p_msg text)
returns void language plpgsql as $$
begin
  if p_cond is distinct from true then
    raise exception 'FAIL: %', p_msg;
  end if;
  raise notice 'ok - %', p_msg;
end $$;

create or replace function tests.eq(p_actual anyelement, p_expected anyelement, p_msg text)
returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FAIL: % (expected %, got %)', p_msg, p_expected, p_actual;
  end if;
  raise notice 'ok - %', p_msg;
end $$;

-- Run SQL and require that it fails with the given domain code (MESSAGE) or SQLSTATE.
create or replace function tests.throws(p_sql text, p_code text, p_msg text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm = p_code or sqlstate = p_code then
      raise notice 'ok - % (got %)', p_msg, sqlerrm;
      return;
    end if;
    raise exception 'FAIL: % (expected %, got % / %)', p_msg, p_code, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL: % (expected error %, but statement succeeded)', p_msg, p_code;
end $$;

create or replace function tests.error_detail(p_sql text)
returns text language plpgsql as $$
declare v_detail text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  return sqlerrm || '|' || coalesce(v_detail, '');
end $$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

-- Local Monday at least 7 days ahead: stable weekday semantics for fixtures.
create or replace function tests.next_monday()
returns date language sql stable as $$
  select (current_date + 7 + ((8 - extract(isodow from current_date + 7)::int) % 7))::date
$$;
