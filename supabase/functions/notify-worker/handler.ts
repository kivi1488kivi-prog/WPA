/**
 * POST /functions/v1/notify-worker   (called every minute by Supabase Cron)
 * Auth: header x-cron-secret = CRON_SECRET (or service-role bearer).
 *
 * Claims due jobs from the notification_jobs outbox with a lease
 * (FOR UPDATE SKIP LOCKED), sends Web Push (VAPID, RFC 8291), reports per
 * device outcomes. Deliveries are at-most-once per (job, device): a device
 * that may already have received a message is never retried.
 */
import { createClient } from '@supabase/supabase-js';
import { bearer, corsHeaders, json, type FnEnv } from '../_shared/http.ts';
import { buildMessage, type NotificationJob } from '../_shared/messages.ts';
import { sendPush, type VapidKeys } from '../_shared/webpush.ts';

interface ClaimedJob extends NotificationJob {
  deliveries: { subscription_id: string; endpoint: string; p256dh: string; auth: string }[];
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function handle(req: Request, env: FnEnv, deps: { fetchImpl?: typeof fetch } = {}): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  const secret = env.get('CRON_SECRET');
  const serviceKey = env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const given = req.headers.get('x-cron-secret') ?? '';
  const authorized = (secret && timingSafeEqual(given, secret)) || (serviceKey && bearer(req) === serviceKey);
  if (!authorized) return json(401, { error: 'unauthorized' });

  const url = env.get('SUPABASE_URL');
  if (!url || !serviceKey) return json(500, { error: 'server_misconfigured' });
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const vapid: VapidKeys | null =
    env.get('VAPID_PUBLIC_KEY') && env.get('VAPID_PRIVATE_KEY')
      ? { publicKey: env.get('VAPID_PUBLIC_KEY')!, privateKey: env.get('VAPID_PRIVATE_KEY')!, subject: env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com' }
      : null;

  const worker = `edge-${crypto.randomUUID().slice(0, 8)}`;
  const claim = await db.rpc('worker_claim_notifications', { p_worker: worker, p_limit: 25, p_lease_seconds: 120 });
  if (claim.error) return json(500, { error: 'claim_failed', detail: claim.error.message });
  const jobs = (claim.data ?? []) as ClaimedJob[];
  const summary = { claimed: jobs.length, sent: 0, gone: 0, retry: 0, failed: 0 };

  for (const job of jobs) {
    if (!vapid) {
      await db.rpc('worker_complete_notification', { p_job_id: job.job_id, p_worker: worker, p_results: job.deliveries.map((d) => ({ subscription_id: d.subscription_id, outcome: 'failed' })), p_error: 'VAPID keys not configured' });
      summary.failed += job.deliveries.length;
      continue;
    }
    const message = buildMessage(job);
    const results = [];
    for (const d of job.deliveries) {
      const r = await sendPush({ endpoint: d.endpoint, p256dh: d.p256dh, auth: d.auth }, message, vapid, {
        urgency: job.event === 'reminder' ? 'normal' : 'high',
        topic: message.tag,
        fetchImpl: deps.fetchImpl,
      });
      summary[r.outcome]++;
      results.push({ subscription_id: d.subscription_id, outcome: r.outcome, http_status: r.status });
    }
    await db.rpc('worker_complete_notification', { p_job_id: job.job_id, p_worker: worker, p_results: results, p_error: results.some((x) => x.outcome !== 'sent') ? 'see deliveries' : null });
  }

  // Cheap housekeeping on every tick (idempotent).
  if (new Date().getUTCMinutes() % 15 === 0 || req.headers.get('x-maintenance') === '1') {
    await db.rpc('worker_maintenance', {});
    await db.rpc('worker_retention', {});
  }
  return json(200, summary);
}
