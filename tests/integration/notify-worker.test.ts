import { describe, expect, it } from 'vitest';
import { handle } from '../../supabase/functions/notify-worker/handler.ts';
import { generateVapidKeys, b64urlEncode } from '../../supabase/functions/_shared/webpush.ts';
import { anon, ENV, pool, signIn, tenantId } from './helpers.ts';

async function subscription() {
  const ua = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
  return { endpoint: `https://push.example.test/${crypto.randomUUID()}`, keys: { p256dh: b64urlEncode(pub), auth: b64urlEncode(crypto.getRandomValues(new Uint8Array(16))) } };
}

describe('notify-worker (real outbox in Postgres, push service stubbed)', () => {
  it('delivers staff-side changes to the customer exactly once, in tenant timezone', async () => {
    const tid = await tenantId('demo-harbor');
    await pool.query("update tenants set status = 'live' where id = $1", [tid]);
    await pool.query("update notification_jobs set status = 'cancelled' where status in ('pending','processing')");
    const svc = (await pool.query("select id from services where tenant_id = $1 and pipeline_key = 'haircut'", [tid])).rows[0].id;
    const dates = await anon().rpc('get_available_dates', { p_slug: 'demo-harbor', p_service_id: svc, p_barber_id: null, p_from: null, p_days: 14 });
    const day = (dates.data as { dates: { date: string; slots: number }[] }).dates.find((d) => d.slots > 1)!.date;
    const slots = (await anon().rpc('get_available_slots', { p_slug: 'demo-harbor', p_service_id: svc, p_barber_id: null, p_date: day })).data as { slots: { starts_at: string }[] };
    const created = await anon().rpc('create_booking', { p_slug: 'demo-harbor', p_service_id: svc, p_barber_id: null, p_starts_at: slots.slots[0]!.starts_at, p_customer: { name: 'Push Test', phone: '+1 212 555 0199' }, p_idempotency_key: crypto.randomUUID() });
    expect(created.error).toBeNull();
    const { token, booking_id } = created.data as { token: string; booking_id: string };
    const sub = await subscription();
    expect((await anon().rpc('register_customer_push', { p_token: token, p_subscription: sub })).error).toBeNull();

    const barberId = (await pool.query('select barber_id from bookings where id = $1', [booking_id])).rows[0].barber_id;
    const own = (await anon().rpc('get_available_slots', { p_slug: 'demo-harbor', p_service_id: svc, p_barber_id: barberId, p_date: day })).data as { slots: { starts_at: string }[] };
    const target = own.slots.find((s) => s.starts_at !== slots.slots[0]!.starts_at)!;
    const owner = await signIn('owner@demo-harbor.test');
    const move = await owner.client.rpc('owner_reschedule_booking', { p_tenant_id: tid, p_booking_id: booking_id, p_new_starts_at: target.starts_at, p_barber_id: null, p_ignore_hours: false, p_idempotency_key: crypto.randomUUID() });
    expect(move.error).toBeNull();

    const vapid = await generateVapidKeys();
    const sent: { url: string; headers: Record<string, string> }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      sent.push({ url, headers: init.headers as Record<string, string> });
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;
    const env = { get: (k: string) => ({ SUPABASE_URL: ENV.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: ENV.SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET: 's3cret', VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: 'mailto:t@example.com' } as Record<string, string>)[k] };

    const unauth = await handle(new Request('http://x/notify', { method: 'POST' }), env, { fetchImpl });
    expect(unauth.status).toBe(401);

    const req = () => new Request('http://x/notify', { method: 'POST', headers: { 'x-cron-secret': 's3cret' } });
    const r1 = (await (await handle(req(), env, { fetchImpl })).json()) as { claimed: number; sent: number };
    expect(r1.sent).toBeGreaterThanOrEqual(1);
    const toCustomer = sent.filter((s) => s.url === sub.endpoint);
    expect(toCustomer).toHaveLength(1);
    expect(toCustomer[0]!.headers['Content-Encoding']).toBe('aes128gcm');

    const r2 = (await (await handle(req(), env, { fetchImpl })).json()) as { sent: number };
    expect(sent.filter((s) => s.url === sub.endpoint)).toHaveLength(1); // no duplicate on next tick
    expect(r2.sent).toBe(0);
    const job = await pool.query("select status from notification_jobs where booking_id = $1 and audience = 'customer' and event = 'rescheduled'", [booking_id]);
    expect(job.rows[0].status).toBe('sent');
    const reminders = await pool.query("select count(*)::int as n from notification_jobs where booking_id = $1 and event = 'reminder' and status = 'pending' and booking_version = 2", [booking_id]);
    expect(reminders.rows[0].n).toBeGreaterThanOrEqual(0);
    await pool.query("update tenants set status = 'preview' where id = $1", [tid]);
  });
});
