-- Shared fixtures: two tenants in different timezones, several barbers with
-- different services and schedules, staff users with all roles.
-- Included by every test file inside BEGIN ... ROLLBACK.

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner-a@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin-a@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', 'barber-anna@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'owner-b@test.local');

select (public.pipeline_publish_tenant($json${
  "slug": "test-a", "name": "Test Shop A", "short_name": "Shop A", "timezone": "Europe/Berlin",
  "locale": "en", "currency": "EUR", "accent_color": "#C8A165", "is_demo": false, "config_hash": "h1",
  "contact": {"phone": "+49 30 1234567", "email": "a@test.local"},
  "location": {"address_line": "Street 1", "city": "Berlin"},
  "legal": {"impressum": {"legal_name": "Test Shop A GmbH", "street": "Street 1", "postal_code": "10115", "city": "Berlin",
            "email": "legal@test.local", "represented_by": "Anna Owner"},
            "privacy": {"retention_months": 24}},
  "rules": {"slot_step_min": 15, "min_lead_min": 60, "max_advance_days": 60,
            "allow_self_cancel": true, "cancel_min_notice_min": 120,
            "allow_self_reschedule": true, "reschedule_min_notice_min": 120, "max_self_reschedules": 2},
  "notifications": {"reminder_offsets_min": [1440, 120], "notify_staff": true},
  "opening_hours": [{"weekday": 1, "start_min": 540, "end_min": 1200}],
  "services": [
    {"key": "cut", "name": "Haircut", "duration_min": 30, "buffer_min": 10, "price_cents": 3000, "sort_order": 1},
    {"key": "beard", "name": "Beard trim", "duration_min": 20, "buffer_min": 0, "price_cents": 1500, "sort_order": 2},
    {"key": "color", "name": "Color", "duration_min": 90, "buffer_min": 0, "price_cents": 8000, "sort_order": 3,
     "policy": {"allow_self_cancel": false}}
  ],
  "barbers": [
    {"key": "anna", "name": "Anna", "services": ["cut", "beard"], "sort_order": 1, "color": "#E07A5F", "marker": "A",
     "hours": [{"weekday": 1, "start_min": 540, "end_min": 780}, {"weekday": 1, "start_min": 840, "end_min": 1080},
               {"weekday": 2, "start_min": 540, "end_min": 1080}, {"weekday": 3, "start_min": 540, "end_min": 1080},
               {"weekday": 4, "start_min": 540, "end_min": 1080}, {"weekday": 5, "start_min": 540, "end_min": 1080}],
     "breaks": [{"weekday": 3, "start_min": 660, "end_min": 690, "label": "Lunch"}]},
    {"key": "boris", "name": "Boris", "services": ["cut", "color"], "sort_order": 2, "color": "#3D405B", "marker": "B",
     "hours": [{"weekday": 1, "start_min": 600, "end_min": 1140}, {"weekday": 2, "start_min": 600, "end_min": 1140},
               {"weekday": 3, "start_min": 600, "end_min": 1140}, {"weekday": 4, "start_min": 600, "end_min": 1140},
               {"weekday": 5, "start_min": 600, "end_min": 1140}, {"weekday": 6, "start_min": 600, "end_min": 1140}]},
    {"key": "clara", "name": "Clara", "services": ["beard"], "sort_order": 3, "color": "#81B29A", "marker": "C",
     "hours": [{"weekday": 2, "start_min": 720, "end_min": 1200}, {"weekday": 3, "start_min": 720, "end_min": 1200}]}
  ],
  "photos": [{"key": "cover", "kind": "cover", "path": "x/pipeline/cover.jpg", "alt": "Cover"}]
}$json$::jsonb) ->> 'tenant_id') as tenant_a \gset

select (public.pipeline_publish_tenant($json${
  "slug": "test-b", "name": "Test Shop B", "short_name": "Shop B", "timezone": "America/New_York",
  "locale": "en", "currency": "USD", "accent_color": "#2A9D8F", "config_hash": "h2",
  "contact": {"phone": "+1 212 5550100"}, "location": {"address_line": "Ave 2", "city": "New York"},
  "rules": {"slot_step_min": 30, "min_lead_min": 0, "max_advance_days": 30, "allow_self_reschedule": false},
  "services": [{"key": "cut", "name": "Cut B", "duration_min": 45, "price_cents": 4000}],
  "barbers": [{"key": "dave", "name": "Dave", "services": ["cut"],
               "hours": [{"weekday": 1, "start_min": 540, "end_min": 1020}]}]
}$json$::jsonb) ->> 'tenant_id') as tenant_b \gset

update public.tenants set status = 'live' where slug in ('test-a', 'test-b');

select id as anna from public.barbers where pipeline_key = 'anna' \gset
select id as boris from public.barbers where pipeline_key = 'boris' \gset
select id as clara from public.barbers where pipeline_key = 'clara' \gset
select id as dave from public.barbers where pipeline_key = 'dave' \gset
select id as cut from public.services where pipeline_key = 'cut' and tenant_id = :'tenant_a' \gset
select id as beard from public.services where pipeline_key = 'beard' and tenant_id = :'tenant_a' \gset
select id as color from public.services where pipeline_key = 'color' and tenant_id = :'tenant_a' \gset
select id as cut_b from public.services where pipeline_key = 'cut' and tenant_id = :'tenant_b' \gset
select tests.next_monday() as monday \gset

select public.pipeline_set_member('test-a', '00000000-0000-0000-0000-0000000000a1', 'owner');
select public.pipeline_set_member('test-a', '00000000-0000-0000-0000-0000000000a2', 'admin');
select public.pipeline_set_member('test-a', '00000000-0000-0000-0000-0000000000a3', 'barber', 'anna');
select public.pipeline_set_member('test-b', '00000000-0000-0000-0000-0000000000b1', 'owner');

-- Role switching macros (transaction-local).
\set as_anon 'reset role; select set_config(''request.jwt.claims'', ''{"role":"anon"}'', true); set local role anon;'
\set as_owner_a 'reset role; select set_config(''request.jwt.claims'', ''{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1"}'', true); set local role authenticated;'
\set as_admin_a 'reset role; select set_config(''request.jwt.claims'', ''{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a2"}'', true); set local role authenticated;'
\set as_barber_anna 'reset role; select set_config(''request.jwt.claims'', ''{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a3"}'', true); set local role authenticated;'
\set as_owner_b 'reset role; select set_config(''request.jwt.claims'', ''{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000b1"}'', true); set local role authenticated;'
\set as_service 'reset role; select set_config(''request.jwt.claims'', ''{"role":"service_role"}'', true); set local role service_role;'
\set as_admin 'reset role; select set_config(''request.jwt.claims'', '''', true);'
