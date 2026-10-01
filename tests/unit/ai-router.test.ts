import { describe, expect, it } from 'vitest';
import { classifyIntent, guardTimes, runAssistant, type ShopFacts } from '../../supabase/functions/_shared/ai/router.ts';
import { executeTool, toolSchemas, toolsFor, type Rpc, type ToolContext } from '../../supabase/functions/_shared/ai/tools.ts';
import { LlmUnavailable, type ChatRequest, type ChatResponse, type LlmClient } from '../../supabase/functions/_shared/ai/llm.ts';

const SHOP = {
  today: '2026-10-05',
  tenant: { name: 'Test Shop', currency: 'EUR', locale: 'de', rules: {} },
  services: [
    { id: 's-cut', name: 'Herrenhaarschnitt', description: null, duration_min: 45, price_cents: 3500, barber_ids: ['b-alex', 'b-marco'] },
    { id: 's-beard', name: 'Bartpflege', description: null, duration_min: 30, price_cents: 2000, barber_ids: ['b-marco'] },
  ],
  barbers: [
    { id: 'b-alex', name: 'Alexej', title: null, specialties: [], service_ids: ['s-cut'] },
    { id: 'b-marco', name: 'Marco', title: null, specialties: [], service_ids: ['s-cut', 's-beard'] },
  ],
  opening_hours: [],
};

function fakeDb() {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const db: Rpc = {
    rpc(fn, args) {
      calls.push({ fn, args });
      const ok = (data: unknown) => Promise.resolve({ data, error: null });
      switch (fn) {
        case 'get_tenant_public':
          return ok(SHOP);
        case 'get_barbers_on_date':
          return ok({ date: args.p_date, barbers: [{ name: 'Alexej', intervals: [{ start: '10:00', end: '14:00' }] }, { name: 'Marco', intervals: [] }] });
        case 'get_available_dates':
          return ok({ dates: [{ date: '2026-10-05', slots: 0 }, { date: '2026-10-06', slots: 3 }] });
        case 'get_available_slots':
          return ok({ slots: [{ local_time: '10:15' }, { local_time: '11:00' }, { local_time: '16:45' }] });
        case 'owner_stats':
          return ok({ totals: { completed_count: 7 } });
        case 'get_booking_by_token':
          return ok({ status: 'confirmed', local_date: '2026-10-07', local_time: '12:00', timezone: 'Europe/Berlin', service: { name: 'Bartpflege' }, barber: { id: 'b-marco', name: 'Marco' }, actions: { can_reschedule: true, reschedule_block_reason: null, can_cancel: true } });
        case 'reschedule_booking_by_token':
          return ok({ local_date: '2026-10-06', local_time: '11:00', barber: { name: 'Marco' } });
        default:
          return Promise.resolve({ data: null, error: { message: 'forbidden' } });
      }
    },
  };
  return { db, calls };
}

function ctx(scope: 'client' | 'owner', db: Rpc, bookingToken: string | null = null): ToolContext {
  return { scope, slug: 'test', tenantId: 'tenant-1', timezone: 'Europe/Berlin', today: '2026-10-05', db, bookingToken, requestId: '00000000-0000-4000-8000-000000000001' };
}

const FACTS: ShopFacts = { name: 'Test Shop', address: 'Street 1', phone: null, openingHours: 'Mon 10:00–20:00', services: ['Herrenhaarschnitt', 'Bartpflege'], barbers: ['Alexej', 'Marco'], locale: 'de' };

/** Scripted LLM: returns the queued responses, records requests. */
function scripted(...responses: ((req: ChatRequest) => ChatResponse)[]): LlmClient & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];
  let i = 0;
  return {
    requests,
    async chat(req) {
      requests.push(structuredClone(req));
      const r = responses[Math.min(i++, responses.length - 1)]!;
      return r(req);
    },
  };
}
const say = (content: string) => () => ({ message: { role: 'assistant' as const, content }, totalTokens: 10 });
const callTool = (name: string, args: unknown) => () => ({
  message: { role: 'assistant' as const, content: null, tool_calls: [{ id: `c_${name}`, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } }] },
  totalTokens: 10,
});

describe('intent pre-routing', () => {
  it('maps questions to server tools', () => {
    expect(classifyIntent('Wann ist ein Herrenhaarschnitt bei Marco frei?', 'client', FACTS, false, '2026-10-05')).toEqual({
      tool: 'find_available_slots', args: { service: 'Herrenhaarschnitt', barber: 'Marco', days: 3 },
    });
    expect(classifyIntent('Gibt es morgen freie Zeiten für Bartpflege?', 'client', FACTS, false, '2026-10-05')?.args).toMatchObject({ date_from: 'tomorrow', days: 1 });
    expect(classifyIntent('Какие барберы работают сегодня?', 'client', FACTS, false, '2026-10-05')).toEqual({ tool: 'barbers_on_date', args: { date: 'today' } });
    expect(classifyIntent('Which services do you offer?', 'client', FACTS, false, '2026-10-05')?.tool).toBe('list_services');
    expect(classifyIntent('Welche Leistungen macht Marco?', 'client', FACTS, false, '2026-10-05')).toEqual({ tool: 'barber_services', args: { barber: 'Marco' } });
    expect(classifyIntent('Verschieb meinen Termin', 'client', FACTS, true, '2026-10-05')?.tool).toBe('get_my_booking');
  });
  it('owner-only intents are never routed for clients', () => {
    expect(classifyIntent('Wie ist der Umsatz diesen Monat?', 'owner', FACTS, false, '2026-10-05')).toEqual({ tool: 'owner_stats', args: { date_from: '2026-10-01', date_to: '2026-10-05' } });
    expect(classifyIntent('Wie ist der Umsatz diesen Monat?', 'client', FACTS, false, '2026-10-05')?.tool ?? null).not.toBe('owner_stats');
  });
});

describe('tool scopes and argument safety', () => {
  it('client and owner tool sets are separated', () => {
    expect(toolsFor('client').map((t) => t.name)).not.toContain('owner_stats');
    expect(toolsFor('owner').map((t) => t.name)).not.toContain('reschedule_my_booking');
    expect(toolSchemas('client').every((t) => !JSON.stringify(t).includes('tenant_id'))).toBe(true);
  });
  it('rejects owner tools in client scope', async () => {
    const { db, calls } = fakeDb();
    const r = await executeTool('owner_stats', { date_from: 'today', date_to: 'today' }, ctx('client', db));
    expect(r).toEqual({ ok: false, result: { error: 'tool_not_allowed', tool: 'owner_stats' } });
    expect(calls).toHaveLength(0);
  });
  it('rejects model-supplied ids (strict schemas)', async () => {
    const { db, calls } = fakeDb();
    const r = await executeTool('find_available_slots', { service: 'Herrenhaarschnitt', barber_id: 'b-alex', tenant_id: 'other' }, ctx('client', db));
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.result)).toContain('invalid_arguments');
    expect(calls).toHaveLength(0);
  });
  it('resolves barber names to ids server-side and refuses ineligible barbers', async () => {
    const { db, calls } = fakeDb();
    const ok = await executeTool('find_available_slots', { service: 'Bartpflege', barber: 'marco' }, ctx('client', db));
    expect(ok.ok).toBe(true);
    expect(calls.find((c) => c.fn === 'get_available_dates')?.args).toMatchObject({ p_service_id: 's-beard', p_barber_id: 'b-marco', p_slug: 'test' });
    const bad = await executeTool('find_available_slots', { service: 'Bartpflege', barber: 'Alexej' }, ctx('client', db));
    expect(bad.result).toMatchObject({ error: 'barber_does_not_offer_service', eligible_barbers: ['Marco'] });
  });
  it('reschedule needs the booking token from context and explicit confirmation', async () => {
    const { db } = fakeDb();
    expect((await executeTool('reschedule_my_booking', { date: '2026-10-06', time: '11:00' }, ctx('client', db, 'tok'.repeat(12)))).ok).toBe(false);
    expect((await executeTool('reschedule_my_booking', { date: '2026-10-06', time: '11:00', user_confirmed: true }, ctx('client', db, null))).result).toEqual({ error: 'no_booking_in_context' });
    const done = await executeTool('reschedule_my_booking', { date: '2026-10-06', time: '11:00', user_confirmed: true }, ctx('client', db, 'tok'.repeat(12)));
    expect(done.result).toMatchObject({ rescheduled: true, time: '11:00' });
  });
});

describe('router: tools mode', () => {
  it('runs a server tool before the model answers availability questions', async () => {
    const { db, calls } = fakeDb();
    const llm = scripted(say('Morgen sind 10:15, 11:00 und 16:45 frei.'));
    const out = await runAssistant({ llm, mode: 'tools', ctx: ctx('client', db), facts: FACTS, history: [{ role: 'user', content: 'Wann ist ein Herrenhaarschnitt frei?' }] });
    expect(calls.some((c) => c.fn === 'get_available_slots')).toBe(true);
    // the very first model request already contains the tool result
    expect(llm.requests[0]!.messages.some((m) => m.role === 'tool' && m.content?.includes('10:15'))).toBe(true);
    expect(out.reply).toContain('10:15');
    expect(out.guarded).toBe(false);
  });
  it('executes model tool calls in a bounded loop', async () => {
    const { db } = fakeDb();
    const llm = scripted(callTool('barbers_on_date', { date: 'tomorrow' }), say('Alexej arbeitet morgen 10:00–14:00.'));
    const out = await runAssistant({ llm, mode: 'tools', ctx: ctx('client', db), facts: FACTS, history: [{ role: 'user', content: 'Hallo!' }] });
    expect(out.toolsUsed).toEqual(['barbers_on_date']);
    expect(out.reply).toContain('Alexej');
    expect(out.steps).toBe(2);
  });
  it('stops after maxSteps even if the model keeps calling tools', async () => {
    const { db } = fakeDb();
    const llm = scripted(callTool('list_services', {}));
    const out = await runAssistant({ llm, mode: 'tools', ctx: ctx('client', db), facts: FACTS, history: [{ role: 'user', content: 'Hi' }], maxSteps: 3 });
    expect(out.steps).toBe(3);
    expect(llm.requests.at(-1)!.tool_choice).toBe('none');
    expect(out.reply.length).toBeGreaterThan(0);
  });
  it('blocks invented times: corrective retry, then deterministic answer from tool data', async () => {
    const { db } = fakeDb();
    const llm = scripted(say('Um 07:15 ist frei!'), say('Dann eben 08:30.'));
    const out = await runAssistant({ llm, mode: 'tools', ctx: ctx('client', db), facts: FACTS, history: [{ role: 'user', content: 'Wann ist ein Herrenhaarschnitt frei?' }] });
    expect(out.guarded).toBe(true);
    expect(out.reply).not.toContain('07:15');
    expect(out.reply).not.toContain('08:30');
    expect(out.reply).toContain('10:15');
  });
  it('propagates LLM outage (handler turns it into 503)', async () => {
    const { db } = fakeDb();
    const llm: LlmClient = { chat: async () => { throw new LlmUnavailable('down'); } };
    await expect(runAssistant({ llm, mode: 'tools', ctx: ctx('client', db), facts: FACTS, history: [{ role: 'user', content: 'Hi' }] })).rejects.toBeInstanceOf(LlmUnavailable);
  });
});

describe('router: JSON-intent fallback mode', () => {
  it('parses {"tool"} / {"answer"} replies and never sends function-calling params', async () => {
    const { db } = fakeDb();
    const llm = scripted(say('```json\n{"tool":"barbers_on_date","args":{"date":"tomorrow"}}\n```'), say('{"answer":"Morgen arbeitet Alexej von 10:00 bis 14:00."}'));
    const out = await runAssistant({ llm, mode: 'json', ctx: ctx('client', db), facts: FACTS, history: [{ role: 'user', content: 'Hallo' }] });
    expect(out.toolsUsed).toEqual(['barbers_on_date']);
    expect(out.reply).toBe('Morgen arbeitet Alexej von 10:00 bis 14:00.');
    expect(llm.requests.every((r) => r.tools === undefined)).toBe(true);
    expect(llm.requests[0]!.messages[0]!.content).toContain('OUTPUT FORMAT');
  });
  it('pre-routes and guards in JSON mode too', async () => {
    const { db } = fakeDb();
    const llm = scripted(say('{"answer":"Frei um 06:00"}'), say('{"answer":"Frei um 06:00"}'));
    const out = await runAssistant({ llm, mode: 'json', ctx: ctx('client', db), facts: FACTS, history: [{ role: 'user', content: 'Wann ist Bartpflege frei?' }] });
    expect(llm.requests[0]!.messages.some((m) => m.content?.startsWith('TOOL RESULT find_available_slots'))).toBe(true);
    expect(out.guarded).toBe(true);
    expect(out.reply).not.toContain('06:00');
  });
  it('owner scope uses owner tools with tenant bound from context', async () => {
    const { db, calls } = fakeDb();
    const llm = scripted(say('{"answer":"7 abgeschlossene Besuche."}'));
    await runAssistant({ llm, mode: 'json', ctx: ctx('owner', db), facts: FACTS, history: [{ role: 'user', content: 'Wie ist der Umsatz?' }] });
    expect(calls.find((c) => c.fn === 'owner_stats')?.args).toMatchObject({ p_tenant_id: 'tenant-1' });
  });
});

describe('guardTimes', () => {
  it('accepts only times present in sources', () => {
    expect(guardTimes('10:15 und 9:30', ['"10:15"', 'Mon 09:30'])).toEqual([]);
    expect(guardTimes('um 7.15 Uhr', ['10:15'])).toEqual(['07:15']);
  });
});
