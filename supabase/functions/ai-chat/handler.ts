/**
 * POST /functions/v1/ai-chat
 * body: { slug, messages: [{role:'user'|'assistant', content}], booking_token?, scope?: 'client'|'owner', request_id? }
 *
 * - Tenant is resolved from the slug on the server (the model never sees ids).
 * - Client scope runs tools with the ANON key; owner scope runs tools with the
 *   caller's own JWT, so the database enforces membership and role.
 * - Budget/rate limits are atomic counters in the DB (service role only).
 * - No transcript is stored. If the LLM is not configured or fails, returns
 *   503 and the app keeps working without the assistant.
 */
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { bearer, clientIp, corsHeaders, json, jwtRole, type FnEnv } from '../_shared/http.ts';
import { LlmUnavailable, openAiCompatible, type LlmClient } from '../_shared/ai/llm.ts';
import { runAssistant, type RouterMode, type ShopFacts } from '../_shared/ai/router.ts';
import type { ToolContext } from '../_shared/ai/tools.ts';

const Body = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(2000) })).min(1).max(30),
  booking_token: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/).nullable().optional(),
  scope: z.enum(['client', 'owner']).default('client'),
  request_id: z.string().uuid().optional(),
});

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export async function handle(req: Request, env: FnEnv, deps: { llm?: LlmClient } = {}): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return json(400, { error: 'invalid_request', detail: (e as Error).message.slice(0, 300) });
  }

  const url = env.get('SUPABASE_URL');
  const anonKey = env.get('SUPABASE_ANON_KEY');
  const serviceKey = env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceKey) return json(500, { error: 'server_misconfigured' });
  const baseUrl = env.get('LLM_BASE_URL');
  const apiKey = env.get('LLM_API_KEY');
  const model = env.get('LLM_MODEL');
  const llm = deps.llm ?? (baseUrl && apiKey && model ? openAiCompatible({ baseUrl, apiKey, model, timeoutMs: Number(env.get('LLM_TIMEOUT_MS') ?? 25000) }) : null);
  if (!llm) return json(503, { error: 'ai_unavailable', reason: 'not_configured' });

  const opts = { auth: { persistSession: false, autoRefreshToken: false } } as const;
  const anon = createClient(url, anonKey, opts);
  const service = createClient(url, serviceKey, opts);

  const shopRes = await anon.rpc('get_tenant_public', { p_slug: body.slug });
  if (shopRes.error) return json(404, { error: 'tenant_not_found' });
  const shop = shopRes.data as {
    today: string;
    tenant: { id: string; name: string; timezone: string; locale: string; phone: string | null; address_line: string | null; city: string | null; ai_enabled: boolean };
    services: { name: string }[];
    barbers: { name: string }[];
    opening_hours: { weekday: number; start_min: number; end_min: number }[];
  };
  if (!shop.tenant.ai_enabled) return json(503, { error: 'ai_unavailable', reason: 'disabled' });

  // Scope: owner only with a real user JWT whose membership the DB confirms.
  let db = anon;
  let clientKey = `ip:${clientIp(req)}`;
  if (body.scope === 'owner') {
    const token = bearer(req);
    if (jwtRole(token) !== 'authenticated') return json(401, { error: 'not_authenticated' });
    const userDb = createClient(url, anonKey, { ...opts, global: { headers: { Authorization: `Bearer ${token}` } } });
    const m = await userDb.rpc('owner_membership', { p_tenant_id: shop.tenant.id });
    if (m.error) return json(403, { error: 'forbidden' });
    db = userDb;
    clientKey = `user:${token?.slice(-16)}`;
  }

  const estimate = 1500 + body.messages.reduce((a, m) => a + Math.ceil(m.content.length / 3), 0);
  const reserve = await service.rpc('ai_reserve', {
    p_tenant_id: shop.tenant.id,
    p_estimated_tokens: estimate,
    p_global_daily_requests: Number(env.get('AI_GLOBAL_DAILY_REQUESTS') ?? 5000),
    p_global_daily_tokens: Number(env.get('AI_GLOBAL_DAILY_TOKENS') ?? 5_000_000),
    p_client_key: clientKey,
  });
  if (reserve.error) return json(503, { error: 'ai_unavailable', reason: 'budget_check_failed' });
  const r = reserve.data as { allowed: boolean; reason?: string; day?: string };
  if (!r.allowed) return json(429, { error: 'ai_limited', reason: r.reason });

  const ctx: ToolContext = {
    scope: body.scope,
    slug: body.slug,
    tenantId: shop.tenant.id,
    timezone: shop.tenant.timezone,
    today: shop.today,
    db,
    bookingToken: body.scope === 'client' ? (body.booking_token ?? null) : null,
    requestId: body.request_id ?? crypto.randomUUID(),
  };
  const facts: ShopFacts = {
    name: shop.tenant.name,
    address: [shop.tenant.address_line, shop.tenant.city].filter(Boolean).join(', '),
    phone: shop.tenant.phone,
    openingHours: WEEK.map((d, i) => {
      const h = shop.opening_hours.filter((x) => x.weekday === i + 1);
      return `${d} ${h.length ? h.map((x) => `${hhmm(x.start_min)}–${hhmm(x.end_min)}`).join(', ') : 'closed'}`;
    }).join('; '),
    services: shop.services.map((s) => s.name),
    barbers: shop.barbers.map((b) => b.name),
    locale: shop.tenant.locale,
  };
  const mode = (env.get('LLM_TOOL_MODE') === 'json' ? 'json' : 'tools') as RouterMode;
  try {
    const out = await runAssistant({ llm, mode, ctx, facts, history: body.messages, maxSteps: Number(env.get('LLM_MAX_STEPS') ?? 4) });
    if (r.day) await service.rpc('ai_commit_usage', { p_tenant_id: shop.tenant.id, p_day: r.day, p_token_delta: out.totalTokens - estimate });
    return json(200, { reply: out.reply, tools_used: out.toolsUsed, guarded: out.guarded, ai: true });
  } catch (e) {
    if (e instanceof LlmUnavailable) return json(503, { error: 'ai_unavailable', reason: 'llm_error' });
    return json(500, { error: 'internal_error' });
  }
}
