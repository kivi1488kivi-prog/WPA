-- Supabase Cron → notify-worker. Run ONCE in the SQL editor of the project
-- (or psql as postgres) after `supabase functions deploy notify-worker`.
-- Replace the two placeholders. The secret is stored in Supabase Vault, not in
-- the job definition, so it never shows up in cron.job.
--
--   <PROJECT_REF>   e.g. abcdefghijklmnop
--   <CRON_SECRET>   same value as the CRON_SECRET function secret

create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('<CRON_SECRET>', 'notify_cron_secret', 'x-cron-secret for notify-worker')
where not exists (select 1 from vault.secrets where name = 'notify_cron_secret');

-- idempotent re-run
select cron.unschedule(jobname) from cron.job where jobname in ('notify-worker', 'maintenance-daily');

-- every minute: deliver due notification jobs (reminders, confirmations, staff alerts)
select cron.schedule(
  'notify-worker',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/notify-worker',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'notify_cron_secret')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);

-- nightly 03:17 UTC: rate-limit counters, stale idempotency records,
-- expired jobs, GDPR retention (anonymize customers past tenants.retention_months)
select cron.schedule(
  'maintenance-daily',
  '17 3 * * *',
  $$ select public.worker_maintenance(); select public.worker_retention(); $$
);

-- check: select jobname, schedule, active from cron.job;
--        select * from cron.job_run_details order by start_time desc limit 20;
