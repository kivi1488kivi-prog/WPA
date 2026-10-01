/**
 * Server-side tools the assistant may use. The model only chooses a tool and
 * human-level arguments (service/barber NAMES, local dates). It never sees or
 * supplies tenant_id, barber_id, SQL or permissions: those are bound from the
 * request context here and enforced again by the database.
 */
import { z } from 'zod';

export type Scope = 'client' | 'owner';

/** Minimal RPC surface (supabase-js client or a test double). */
export interface Rpc {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; details?: string | null } | null }>;
}

export interface ToolContext {
  scope: Scope;
  slug: string;
  tenantId: string;
  timezone: string;
  today: string; // tenant-local YYYY-MM-DD
  /** anon client (client scope) or the user's JWT client (owner scope) */
  db: Rpc;
  /** booking access token from the request (client scope), never from the model */
  bookingToken: string | null;
  requestId: string;
}

export interface ToolDef<A extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  scopes: Scope[];
  args: A;
  run: (args: z.infer<A>, ctx: ToolContext) => Promise<unknown>;
}

const DateArg = z
  .string()
  .regex(/^(today|tomorrow|\d{4}-\d{2}-\d{2})$/, 'YYYY-MM-DD, "today" or "tomorrow"')
  .describe('Local date in the shop timezone: YYYY-MM-DD, "today" or "tomorrow"');

function resolveDate(d: string | undefined, today: string): string {
  if (!d || d === 'today') return today;
  if (d === 'tomorrow') return addDays(today, 1);
  return d;
}
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

async function call(ctx: ToolContext, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await ctx.db.rpc(fn, args);
  if (res.error) throw new ToolError(res.error.message, res.error.details ?? undefined);
  return res.data;
}

export class ToolError extends Error {
  constructor(message: string, readonly detail?: string) {
    super(message);
  }
}

interface ShopPayload {
  tenant: { name: string; currency: string; locale: string; rules: Record<string, unknown> };
  services: { id: string; name: string; description: string | null; duration_min: number; price_cents: number; barber_ids: string[] }[];
  barbers: { id: string; name: string; title: string | null; specialties: string[]; service_ids: string[] }[];
  opening_hours: { weekday: number; start_min: number; end_min: number }[];
}

async function shop(ctx: ToolContext): Promise<ShopPayload> {
  return (await call(ctx, 'get_tenant_public', { p_slug: ctx.slug })) as ShopPayload;
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9а-яё]+/g, ' ').trim();

/** Fuzzy match of a human name against a list (exact > prefix > contains). */
export function matchByName<T extends { name: string }>(items: T[], query: string | undefined): T | null {
  if (!query) return null;
  const q = norm(query);
  if (!q) return null;
  return (
    items.find((i) => norm(i.name) === q) ??
    items.find((i) => norm(i.name).startsWith(q) || q.startsWith(norm(i.name))) ??
    items.find((i) => norm(i.name).includes(q) || q.includes(norm(i.name))) ??
    null
  );
}

const money = (cents: number, currency: string, locale: string) =>
  new Intl.NumberFormat(locale === 'de' ? 'de-DE' : locale === 'ru' ? 'ru-RU' : 'en-US', { style: 'currency', currency }).format(cents / 100);

function defineTool<A extends z.ZodTypeAny>(t: ToolDef<A>): ToolDef {
  return t as unknown as ToolDef;
}

export const TOOLS: ToolDef[] = [
  defineTool({
    name: 'list_services',
    description: 'List bookable services with duration, price and which barbers perform them.',
    scopes: ['client', 'owner'],
    args: z.object({}).strict(),
    run: async (_a, ctx) => {
      const s = await shop(ctx);
      const byId = new Map(s.barbers.map((b) => [b.id, b.name]));
      return s.services.map((x) => ({
        service: x.name,
        duration_min: x.duration_min,
        price: money(x.price_cents, s.tenant.currency, s.tenant.locale),
        description: x.description,
        barbers: x.barber_ids.map((id) => byId.get(id)).filter(Boolean),
      }));
    },
  }),
  defineTool({
    name: 'barbers_on_date',
    description: 'Which barbers work on a date and their working hours (local time). Use for "who works today/tomorrow".',
    scopes: ['client', 'owner'],
    args: z.object({ date: DateArg.optional() }).strict(),
    run: async (a, ctx) => {
      const date = resolveDate(a.date, ctx.today);
      const r = (await call(ctx, 'get_barbers_on_date', { p_slug: ctx.slug, p_date: date })) as { barbers: { name: string; intervals: { start: string; end: string }[] }[] };
      return { date, timezone: ctx.timezone, barbers: r.barbers.map((b) => ({ barber: b.name, working: b.intervals.length > 0, hours: b.intervals })) };
    },
  }),
  defineTool({
    name: 'barber_services',
    description: 'Services a specific barber performs (by barber name).',
    scopes: ['client', 'owner'],
    args: z.object({ barber: z.string().min(1).max(60).describe('Barber name as shown to clients') }).strict(),
    run: async (a, ctx) => {
      const s = await shop(ctx);
      const b = matchByName(s.barbers, a.barber);
      if (!b) return { error: 'barber_not_found', barbers: s.barbers.map((x) => x.name) };
      const svc = new Map(s.services.map((x) => [x.id, x]));
      return {
        barber: b.name,
        title: b.title,
        specialties: b.specialties,
        services: b.service_ids.map((id) => svc.get(id)).filter(Boolean).map((x) => ({ service: x!.name, duration_min: x!.duration_min, price: money(x!.price_cents, s.tenant.currency, s.tenant.locale) })),
      };
    },
  }),
  defineTool({
    name: 'find_available_slots',
    description:
      'REAL free start times computed by the booking engine (durations, schedules, breaks, vacations, blocks, existing bookings). Always call before mentioning any free time.',
    scopes: ['client', 'owner'],
    args: z
      .object({
        service: z.string().min(1).max(80).describe('Service name'),
        barber: z.string().max(60).optional().describe('Barber name, or omit / "any" for any available barber'),
        date_from: DateArg.optional(),
        days: z.number().int().min(1).max(7).optional().describe('How many days to search, default 3'),
      })
      .strict(),
    run: async (a, ctx) => {
      const s = await shop(ctx);
      const service = matchByName(s.services, a.service);
      if (!service) return { error: 'service_not_found', services: s.services.map((x) => x.name) };
      let barberId: string | null = null;
      let barberName = 'any';
      if (a.barber && !/^(any|любой|beliebig|egal)/i.test(a.barber)) {
        const b = matchByName(s.barbers.filter((x) => service.barber_ids.includes(x.id)), a.barber);
        if (!b) return { error: 'barber_does_not_offer_service', eligible_barbers: s.barbers.filter((x) => service.barber_ids.includes(x.id)).map((x) => x.name) };
        barberId = b.id;
        barberName = b.name;
      }
      const from = resolveDate(a.date_from, ctx.today);
      const dates = (await call(ctx, 'get_available_dates', { p_slug: ctx.slug, p_service_id: service.id, p_barber_id: barberId, p_from: from, p_days: Math.max(a.days ?? 3, 7) })) as {
        dates: { date: string; slots: number }[];
      };
      const withSlots = dates.dates.filter((d) => d.slots > 0).slice(0, a.days ?? 3);
      const out: { date: string; times: string[] }[] = [];
      for (const d of withSlots) {
        const sl = (await call(ctx, 'get_available_slots', { p_slug: ctx.slug, p_service_id: service.id, p_barber_id: barberId, p_date: d.date })) as { slots: { local_time: string }[] };
        out.push({ date: d.date, times: sl.slots.map((x) => x.local_time).slice(0, 24) });
      }
      return { service: service.name, barber: barberName, timezone: ctx.timezone, searched_from: from, days: out, none_found: out.length === 0 };
    },
  }),
  defineTool({
    name: 'get_my_booking',
    description: "The client's own booking (only when the client opened the assistant from a booking link).",
    scopes: ['client'],
    args: z.object({}).strict(),
    run: async (_a, ctx) => {
      if (!ctx.bookingToken) return { error: 'no_booking_in_context' };
      const b = (await call(ctx, 'get_booking_by_token', { p_token: ctx.bookingToken })) as Record<string, unknown>;
      return {
        status: b.status,
        date: b.local_date,
        time: b.local_time,
        timezone: b.timezone,
        service: (b.service as { name: string }).name,
        barber: (b.barber as { name: string }).name,
        can_reschedule: (b.actions as { can_reschedule: boolean }).can_reschedule,
        reschedule_block_reason: (b.actions as { reschedule_block_reason: string | null }).reschedule_block_reason,
        can_cancel: (b.actions as { can_cancel: boolean }).can_cancel,
      };
    },
  }),
  defineTool({
    name: 'reschedule_my_booking',
    description:
      'Move the client\'s own booking to a new local date/time. Only call after the client explicitly confirmed a specific time that find_available_slots returned. Set user_confirmed=true only then.',
    scopes: ['client'],
    args: z
      .object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        keep_barber: z.boolean().default(true),
        user_confirmed: z.literal(true),
      })
      .strict(),
    run: async (a, ctx) => {
      if (!ctx.bookingToken) return { error: 'no_booking_in_context' };
      const startsAt = zonedToUtc(a.date, Number(a.time.slice(0, 2)) * 60 + Number(a.time.slice(3, 5)), ctx.timezone).toISOString();
      const current = (await call(ctx, 'get_booking_by_token', { p_token: ctx.bookingToken })) as { barber: { id: string } };
      const b = (await call(ctx, 'reschedule_booking_by_token', {
        p_token: ctx.bookingToken,
        p_new_starts_at: startsAt,
        p_barber_id: a.keep_barber ? current.barber.id : null,
        p_any_barber: !a.keep_barber,
        p_idempotency_key: await uuidFrom(`${ctx.requestId}:${startsAt}:${a.keep_barber}`),
      })) as Record<string, unknown>;
      return { rescheduled: true, date: b.local_date, time: b.local_time, barber: (b.barber as { name: string }).name };
    },
  }),
  defineTool({
    name: 'owner_day_overview',
    description: 'Staff only: bookings, blocks and free intervals per barber for a date.',
    scopes: ['owner'],
    args: z.object({ date: DateArg.optional() }).strict(),
    run: async (a, ctx) => {
      const date = resolveDate(a.date, ctx.today);
      const c = (await call(ctx, 'owner_calendar', { p_tenant_id: ctx.tenantId, p_from: date, p_to: date, p_barber_id: null })) as {
        barbers: { id: string; name: string }[];
        bookings: { barber_id: string; starts_at: string; status: string; service_name: string; customer_name: string }[];
        days: { barber_id: string; free: { start: string; end: string }[] }[];
      };
      const hhmm = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: ctx.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
      return {
        date,
        timezone: ctx.timezone,
        barbers: c.barbers.map((b) => ({
          barber: b.name,
          bookings: c.bookings.filter((x) => x.barber_id === b.id).map((x) => ({ time: hhmm(x.starts_at), status: x.status, service: x.service_name, client: x.customer_name })),
          free: (c.days.find((d) => d.barber_id === b.id)?.free ?? []).map((f) => `${hhmm(f.start)}–${hhmm(f.end)}`),
        })),
      };
    },
  }),
  defineTool({
    name: 'owner_stats',
    description: 'Staff only: statistics for a period (same numbers as the statistics screen). Upcoming value is expected, not revenue.',
    scopes: ['owner'],
    args: z.object({ date_from: DateArg, date_to: DateArg, barber: z.string().max(60).optional(), service: z.string().max(80).optional() }).strict(),
    run: async (a, ctx) => {
      const s = await shop(ctx);
      const barber = a.barber ? matchByName(s.barbers, a.barber) : null;
      const service = a.service ? matchByName(s.services, a.service) : null;
      return call(ctx, 'owner_stats', {
        p_tenant_id: ctx.tenantId,
        p_from: resolveDate(a.date_from, ctx.today),
        p_to: resolveDate(a.date_to, ctx.today),
        p_barber_id: barber?.id ?? null,
        p_service_id: service?.id ?? null,
      });
    },
  }),
];

export function toolsFor(scope: Scope): ToolDef[] {
  return TOOLS.filter((t) => t.scopes.includes(scope));
}

/** Validate & execute one tool call within the caller's scope. Never throws. */
export async function executeTool(name: string, rawArgs: unknown, ctx: ToolContext): Promise<{ ok: boolean; result: unknown }> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool || !tool.scopes.includes(ctx.scope)) return { ok: false, result: { error: 'tool_not_allowed', tool: name } };
  const parsed = tool.args.safeParse(rawArgs ?? {});
  if (!parsed.success) return { ok: false, result: { error: 'invalid_arguments', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) } };
  try {
    return { ok: true, result: await tool.run(parsed.data, ctx) };
  } catch (e) {
    const err = e as ToolError;
    return { ok: false, result: { error: err.message, detail: err.detail } };
  }
}

/** JSON schema for OpenAI-compatible function calling. */
export function toolSchemas(scope: Scope) {
  return toolsFor(scope).map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: z.toJSONSchema(t.args, { io: 'input', unrepresentable: 'any' }) },
  }));
}

export function zonedToUtc(isoDate: string, minutes: number, tz: string): Date {
  const [y, mo, d] = isoDate.split('-').map(Number) as [number, number, number];
  const wall = Date.UTC(y, mo - 1, d, 0, minutes);
  let guess = wall;
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(guess));
    const g = (k: string) => Number(parts.find((p) => p.type === k)?.value ?? 0);
    const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second'));
    const next = wall - (asUtc - guess);
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}

async function uuidFrom(seed: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed))).slice(0, 16);
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const hex = [...h].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
