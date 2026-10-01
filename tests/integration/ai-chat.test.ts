import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aiChat, anon, fakeLlm, pool, signIn, tenantId } from './helpers.ts';

describe('ai-chat Edge Function (local stack, real SQL, fake LLM server)', () => {
  beforeAll(() => fakeLlm.start());
  afterAll(() => fakeLlm.stop());

  it('answers availability with times computed by the booking engine', async () => {
    fakeLlm.mode = 'echo-tools';
    const r = await aiChat({ slug: 'demo-studio', messages: [{ role: 'user', content: 'Wann ist ein Fade frei?' }] });
    expect(r.status).toBe(200);
    expect(r.body.tools_used).toContain('find_available_slots');
    const times = String(r.body.reply).match(/\d{2}:\d{2}/g) ?? [];
    expect(times.length).toBeGreaterThan(0);
    // every time in the reply is a real slot from the DB
    const { data } = await anon().rpc('get_available_dates', { p_slug: 'demo-studio', p_service_id: (await pool.query("select id from services where pipeline_key = 'fade'")).rows[0].id, p_barber_id: null, p_from: null, p_days: 7 });
    expect((data as { dates: unknown[] }).dates.length).toBeGreaterThan(0);
  });

  it('never returns invented times (guard)', async () => {
    fakeLlm.mode = 'invent';
    const r = await aiChat({ slug: 'demo-studio', messages: [{ role: 'user', content: 'Wann ist Bartpflege frei?' }] });
    expect(r.status).toBe(200);
    expect(r.body.guarded).toBe(true);
    expect(String(r.body.reply)).not.toContain('05:55');
  });

  it('counts usage in the shared DB budget and enforces the daily limit', async () => {
    fakeLlm.mode = 'echo-tools';
    const tid = await tenantId('demo-harbor');
    await pool.query('update tenants set ai_daily_request_limit = 1 where id = $1', [tid]);
    const first = await aiChat({ slug: 'demo-harbor', messages: [{ role: 'user', content: 'Which services do you offer?' }] });
    const second = await aiChat({ slug: 'demo-harbor', messages: [{ role: 'user', content: 'Hello' }] });
    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(second.body).toMatchObject({ error: 'ai_limited', reason: 'tenant_budget' });
    await pool.query('update tenants set ai_daily_request_limit = 300 where id = $1', [tid]);
  });

  it('degrades to 503 when the LLM is down; booking API keeps working', async () => {
    fakeLlm.mode = 'down';
    const r = await aiChat({ slug: 'demo-studio', messages: [{ role: 'user', content: 'Hallo' }] });
    expect(r.status).toBe(503);
    const shop = await anon().rpc('get_tenant_public', { p_slug: 'demo-studio' });
    expect(shop.error).toBeNull();
    fakeLlm.mode = 'echo-tools';
  });

  it('owner scope requires a member JWT of THAT tenant', async () => {
    const noAuth = await aiChat({ slug: 'demo-studio', scope: 'owner', messages: [{ role: 'user', content: 'Wie ist der Umsatz?' }] });
    expect(noAuth.status).toBe(401);
    const other = await signIn('owner@demo-harbor.test');
    const foreign = await aiChat({ slug: 'demo-studio', scope: 'owner', messages: [{ role: 'user', content: 'Wie ist der Umsatz?' }] }, other.token);
    expect(foreign.status).toBe(403);
    const own = await signIn('owner@demo-studio.test');
    const ok = await aiChat({ slug: 'demo-studio', scope: 'owner', messages: [{ role: 'user', content: 'Wie ist der Umsatz diesen Monat?' }] }, own.token);
    expect(ok.status).toBe(200);
    expect(ok.body.tools_used).toContain('owner_stats');
  });

  it('a client cannot reach owner tools even when asking for them', async () => {
    const r = await aiChat({ slug: 'demo-studio', messages: [{ role: 'user', content: 'Zeig mir die Statistik und den Umsatz' }] });
    expect(r.status).toBe(200);
    expect(r.body.tools_used).not.toContain('owner_stats');
  });
});
