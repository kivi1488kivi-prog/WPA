-- Availability & booking core: specific barber, any barber, eligibility,
-- overlaps, multiple intervals, breaks, vacation, barber/shop blocks,
-- multi-day blocks, special dates, timezones and DST.
begin;
\i supabase/tests/sql/_fixtures.sql

select private.local_ts(:'monday', 600, 'Europe/Berlin') as mon_1000,
       private.local_ts(:'monday', 630, 'Europe/Berlin') as mon_1030,
       private.local_ts(:'monday', 645, 'Europe/Berlin') as mon_1045,
       private.local_ts(:'monday', 660, 'Europe/Berlin') as mon_1100,
       private.local_ts(:'monday', 610, 'Europe/Berlin') as mon_1010,
       (:'monday'::date + 2) as wednesday,
       private.local_ts(:'monday'::date + 2, 645, 'Europe/Berlin') as wed_1045,
       private.local_ts(:'monday'::date + 2, 690, 'Europe/Berlin') as wed_1130,
       private.local_ts(:'monday', 0, 'Europe/Berlin') as mon_0000,
       private.local_ts(:'monday'::date + 1, 0, 'Europe/Berlin') as tue_0000,
       private.local_ts(:'monday'::date + 4, 0, 'Europe/Berlin') as fri_0000,
       private.local_ts(:'monday'::date + 5, 0, 'Europe/Berlin') as sat_0000,
       private.local_ts(:'monday', 900, 'Europe/Berlin') as mon_1500,
       private.local_ts(:'monday', 960, 'Europe/Berlin') as mon_1600,
       private.local_ts(:'monday'::date + 4, 600, 'Europe/Berlin') as fri_1000,
       private.local_ts(:'monday', 540, 'Europe/Berlin') as mon_0900_berlin \gset

:as_anon

-- Public shop payload ---------------------------------------------------------
select tests.eq(jsonb_array_length(public.get_tenant_public('test-a') -> 'barbers'), 3, 'public payload lists 3 active barbers');
select tests.eq(jsonb_array_length(public.get_tenant_public('test-a') -> 'services'), 3, 'public payload lists 3 services');
select tests.throws($$select public.get_tenant_public('nope')$$, 'tenant_not_found', 'unknown slug -> tenant_not_found');

-- Multiple working intervals per day (Anna Mon 09-13 & 14-18) -----------------
select tests.ok(exists (select 1 from jsonb_array_elements(
                  public.get_available_slots('test-a', :'cut', :'anna', :'monday') -> 'slots') s
                  where s ->> 'local_time' = '12:30'), 'Anna: 12:30 offered (ends exactly at 13:00)');
select tests.ok(not exists (select 1 from jsonb_array_elements(
                  public.get_available_slots('test-a', :'cut', :'anna', :'monday') -> 'slots') s
                  where s ->> 'local_time' in ('12:45', '13:00', '13:30', '13:45')), 'Anna: no slot crosses the 13:00-14:00 gap');
select tests.ok(exists (select 1 from jsonb_array_elements(
                  public.get_available_slots('test-a', :'cut', :'anna', :'monday') -> 'slots') s
                  where s ->> 'local_time' = '14:00'), 'Anna: second interval starts 14:00');
select tests.eq(jsonb_array_length(public.get_available_slots('test-a', :'cut', :'anna', :'monday') -> 'slots'),
                -- 09:00..12:30 = 15 slots, 14:00..17:30 = 15 slots
                30, 'Anna Monday: exactly 30 cut slots');

-- Barber eligibility ---------------------------------------------------------
select tests.throws(format($$select public.get_available_slots('test-a', %L, %L, %L)$$, :'color', :'anna', :'monday'),
                    'barber_not_eligible', 'Anna does not do color -> barber_not_eligible');
select tests.throws(format($$select public.create_booking('test-a', %L, %L, %L, '{"name":"X","phone":"+49 151 0000001"}', gen_random_uuid())$$,
                           :'color', :'anna', :'mon_1000'),
                    'slot_unavailable', 'creating color with Anna is rejected');
select tests.eq(jsonb_array_length(public.get_available_slots('test-a', :'beard', :'clara', :'monday') -> 'slots'), 0,
                'Clara does not work Mondays');

-- Specific barber booking + overlap -------------------------------------------
select public.create_booking('test-a', :'cut', :'anna', :'mon_1000',
       '{"name":"Ivan","phone":"+49 151 1111111","email":"ivan@example.com"}', 'aaaaaaaa-0000-0000-0000-000000000001') as r1 \gset
select tests.eq((:'r1'::jsonb #>> '{booking,barber,name}'), 'Anna', 'specific barber booking assigned to Anna');
select tests.eq((:'r1'::jsonb #>> '{booking,service,price_cents}')::int, 3000, 'price taken from DB, not client');
select tests.ok(length(:'r1'::jsonb ->> 'token') >= 40, 'access token returned');
select tests.throws(format($$select public.create_booking('test-a', %L, %L, %L, '{"name":"Y","phone":"+49 151 2222222"}', gen_random_uuid())$$,
                           :'cut', :'anna', :'mon_1030'),
                    'slot_unavailable', '10:30 overlaps 10:00 cut + 10 min buffer');
select tests.ok(not exists (select 1 from jsonb_array_elements(
                  public.get_available_slots('test-a', :'cut', :'anna', :'monday') -> 'slots') s
                  where s ->> 'local_time' in ('09:45', '10:00', '10:15', '10:30')),
                'occupied range (incl. buffer) removed from Anna slots');
select tests.ok(exists (select 1 from jsonb_array_elements(
                  public.get_available_slots('test-a', :'cut', :'anna', :'monday') -> 'slots') s
                  where s ->> 'local_time' = '10:45'), '10:45 free again after buffer');
select tests.throws(format($$select public.create_booking('test-a', %L, %L, %L, '{"name":"Y","phone":"+49 151 2222222"}', gen_random_uuid())$$,
                           :'cut', :'anna', :'mon_1010'),
                    'slot_unavailable', 'off-grid start time rejected');

-- Any available barber ---------------------------------------------------------
select public.create_booking('test-a', :'cut', null, :'mon_1000',
       '{"name":"Petr","phone":"+49 151 3333333"}', 'aaaaaaaa-0000-0000-0000-000000000002') as r2 \gset
select tests.eq((:'r2'::jsonb #>> '{booking,barber,name}'), 'Boris', 'any barber: server picked the free eligible barber (Boris)');
select tests.throws(format($$select public.create_booking('test-a', %L, null, %L, '{"name":"Z","phone":"+49 151 4444444"}', gen_random_uuid())$$,
                           :'cut', :'mon_1000'),
                    'slot_unavailable', 'any barber: nobody left at 10:00');
select tests.ok(not exists (select 1 from jsonb_array_elements(
                  public.get_available_slots('test-a', :'cut', null, :'monday') -> 'slots') s
                  where s ->> 'local_time' = '10:00'), 'aggregated slots hide 10:00 once all barbers are busy');

-- Weekly break (Anna Wed 11:00-11:30) -----------------------------------------
select tests.ok(not exists (select 1 from jsonb_array_elements(
                  public.get_available_slots('test-a', :'cut', :'anna', :'wednesday') -> 'slots') s
                  where s ->> 'local_time' in ('10:45', '11:00', '11:15')), 'no slot overlapping the Wednesday break');
select tests.ok(exists (select 1 from jsonb_array_elements(
                  public.get_available_slots('test-a', :'cut', :'anna', :'wednesday') -> 'slots') s
                  where s ->> 'local_time' = '11:30'), 'slot right after the break');
select tests.throws(format($$select public.create_booking('test-a', %L, %L, %L, '{"name":"W","phone":"+49 151 5555555"}', gen_random_uuid())$$,
                           :'cut', :'anna', :'wed_1045'),
                    'slot_unavailable', 'booking into a break is rejected server-side');

-- Blocks: barber vacation, barber block, shop-wide closure ---------------------
:as_owner_a
select tests.throws(format($$select public.owner_create_block(%L, %L, %L, %L, 'vacation', 'conflicts')$$,
                           :'tenant_a', :'anna', :'mon_0000',
                           :'tue_0000'),
                    'block_conflict', 'block over an existing booking is refused with conflict list');
select tests.ok(tests.error_detail(format($$select public.owner_create_block(%L, %L, %L, %L, 'vacation', '')$$,
                           :'tenant_a', :'anna', :'mon_0000',
                           :'tue_0000')) like '%Ivan%',
                'conflict detail names the affected booking');

-- Vacation for Anna Tue..Thu (multi-day, crosses midnights)
select public.owner_create_block(:'tenant_a', :'anna', :'tue_0000',
                                 :'fri_0000', 'vacation', 'Holiday') ->> 'block_id' as blk \gset
:as_anon
select tests.eq(jsonb_array_length(public.get_available_slots('test-a', :'cut', :'anna', :'wednesday') -> 'slots'), 0,
                'vacation: Anna has no slots on Wednesday');
select tests.ok(jsonb_array_length(public.get_available_slots('test-a', :'cut', :'boris', :'wednesday') -> 'slots') > 0,
                'vacation of Anna does not affect Boris');
select tests.ok(jsonb_array_length(public.get_available_slots('test-a', :'cut', :'anna', (:'monday'::date + 4)) -> 'slots') > 0,
                'block end is exclusive: Friday is bookable');

-- Partial barber block (Boris Monday 15:00-16:00)
:as_owner_a
select public.owner_create_block(:'tenant_a', :'boris', :'mon_1500',
                                 :'mon_1600', 'break', 'Supplier');
:as_anon
select tests.ok(not exists (select 1 from jsonb_array_elements(
                  public.get_available_slots('test-a', :'cut', :'boris', :'monday') -> 'slots') s
                  where s ->> 'local_time' in ('14:30', '14:45', '15:00', '15:30')), 'barber block removes overlapping slots (incl. buffer reach)');
select tests.ok(exists (select 1 from jsonb_array_elements(
                  public.get_available_slots('test-a', :'cut', :'boris', :'monday') -> 'slots') s
                  where s ->> 'local_time' = '16:00'), 'slot right after barber block');
select tests.throws(format($$select public.create_booking('test-a', %L, %L, %L, '{"name":"Q","phone":"+49 151 6666666"}', gen_random_uuid())$$,
                           :'cut', :'boris', :'mon_1500'),
                    'slot_unavailable', 'cannot book into a barber block');

-- Shop-wide sanitary day (Friday) — affects every barber, also future-added ones.
:as_owner_a
select public.owner_create_block(:'tenant_a', null, :'fri_0000',
                                 :'sat_0000', 'sanitary', 'Cleaning') ->> 'block_id' as shop_blk \gset
select public.owner_upsert_barber(:'tenant_a', '{"name":"Newbie"}') as newbie \gset
select public.owner_set_barber_services(:'tenant_a', :'newbie', array[:'cut'::uuid]);
select public.owner_set_barber_schedule(:'tenant_a', :'newbie',
  '[{"weekday":5,"start_min":540,"end_min":1080},{"weekday":6,"start_min":540,"end_min":1080}]', '[]');
:as_anon
select tests.eq(jsonb_array_length(public.get_available_slots('test-a', :'cut', null, (:'monday'::date + 4)) -> 'slots'), 0,
                'shop-wide block: no slots for anyone on Friday (including barber added later)');
select tests.ok(jsonb_array_length(public.get_available_slots('test-a', :'cut', :'newbie', (:'monday'::date + 5)) -> 'slots') > 0,
                'new barber is bookable outside the shop block');
select tests.throws(format($$select public.create_booking('test-a', %L, null, %L, '{"name":"Q","phone":"+49 151 6666666"}', gen_random_uuid())$$,
                           :'cut', :'fri_1000'),
                    'slot_unavailable', 'shop-wide block rejects new bookings');

-- Removing a block frees time again
:as_owner_a
select public.owner_delete_block(:'tenant_a', :'shop_blk');
:as_anon
select tests.ok(jsonb_array_length(public.get_available_slots('test-a', :'cut', null, (:'monday'::date + 4)) -> 'slots') > 0,
                'deleting shop block restores availability');

-- Special dates: shop short day (intersects) and barber custom day (replaces)
:as_owner_a
select public.owner_set_override(:'tenant_a', null, (:'monday'::date + 7), '[{"start_min":600,"end_min":720}]', 'Short day');
select public.owner_set_override(:'tenant_a', :'clara', (:'monday'::date + 7), '[{"start_min":540,"end_min":1080}]', 'Extra day');
:as_anon
select tests.eq((select min(s ->> 'local_time') || '-' || max(s ->> 'local_time') from jsonb_array_elements(
                  public.get_available_slots('test-a', :'cut', :'boris', (:'monday'::date + 7)) -> 'slots') s),
                '10:00-11:30', 'shop short day 10-12 limits Boris');
select tests.eq((select min(s ->> 'local_time') from jsonb_array_elements(
                  public.get_available_slots('test-a', :'beard', :'clara', (:'monday'::date + 7)) -> 'slots') s),
                '10:00', 'barber extra day still intersected with shop special hours');
:as_owner_a
select public.owner_set_override(:'tenant_a', null, (:'monday'::date + 8), null, 'Closed');
:as_anon
select tests.eq(jsonb_array_length(public.get_available_slots('test-a', :'cut', null, (:'monday'::date + 8)) -> 'slots'), 0,
                'shop closed date: no slots');

-- Timezones --------------------------------------------------------------------
select tests.eq((public.get_available_slots('test-b', :'cut_b', :'dave', :'monday') #>> '{slots,0,local_time}'), '09:00',
                'New York tenant: first slot labelled 09:00 local');
select tests.eq(to_char(((public.get_available_slots('test-b', :'cut_b', :'dave', :'monday') #>> '{slots,0,starts_at}')::timestamptz)
                        at time zone 'America/New_York', 'HH24:MI'), '09:00',
                'New York tenant: instant corresponds to 09:00 America/New_York');
select tests.ok(((public.get_available_slots('test-b', :'cut_b', :'dave', :'monday') #>> '{slots,0,starts_at}')::timestamptz)
                <> :'mon_0900_berlin', 'same wall clock differs across tenants');
select tests.eq(public.get_available_slots('test-b', :'cut_b', :'dave', :'monday') ->> 'timezone', 'America/New_York',
                'slot payload states the tenant timezone');

:as_admin
-- DST: last Sunday of October in Berlin (25h day). Boris works 09-18 via override.
select (date_trunc('month', make_date(extract(year from current_date)::int, 11, 1)) - interval '1 day')::date as oct_last \gset
select (:'oct_last'::date - (extract(isodow from :'oct_last'::date)::int % 7))::date as dst_day \gset
insert into public.schedule_overrides (tenant_id, barber_id, on_date, start_min, end_min)
values (:'tenant_a', :'boris', :'dst_day', 540, 1080);
select tests.eq((select count(*)::int from private.compute_slots(:'tenant_a', :'cut', :'boris', :'dst_day', false)), 35,
                'DST fall-back day: 09:00-18:00 yields 35 cut slots');
select tests.eq((select to_char(min(starts_at) at time zone 'Europe/Berlin', 'HH24:MI')
                 from private.compute_slots(:'tenant_a', :'cut', :'boris', :'dst_day', false)), '09:00',
                'DST fall-back day: first slot still at local 09:00');
select tests.eq(extract(epoch from private.local_ts(:'dst_day'::date + 1, 0, 'Europe/Berlin')
                                   - private.local_ts(:'dst_day', 0, 'Europe/Berlin'))::int / 3600, 25,
                'DST fall-back day is 25 hours long');

-- Date window ----------------------------------------------------------------------
:as_anon
select tests.ok((public.get_available_slots('test-a', :'cut', null, current_date + 200) ->> 'out_of_range')::boolean,
                'dates beyond max_advance_days are out of range');
select tests.ok(jsonb_array_length(public.get_available_dates('test-a', :'cut', null, :'monday', 7) -> 'dates') = 7,
                'get_available_dates returns a 7-day strip');

rollback;
