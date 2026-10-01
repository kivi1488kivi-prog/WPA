/**
 * Assistant router: deterministic pre-routing + bounded tool loop + JSON-intent
 * fallback + a guard against invented times.
 *
 *  1. classifyIntent() inspects the last user message. For questions about
 *     services, barbers, availability, bookings or schedules the matching
 *     server tool runs BEFORE the model is called, and its result is given to
 *     the model. The model therefore never answers those from memory.
 *  2. mode "tools": OpenAI-style function calling, at most `maxSteps` rounds.
 *     mode "json": for models without tool calling — the model replies with
 *     {"tool":..,"args":..} or {"answer":..}; parsed leniently, same bound.
 *  3. guardTimes(): any HH:MM in the final answer must appear in tool results
 *     or in the shop facts given to the model; otherwise one corrective retry,
 *     then a deterministic answer built from tool data.
 */
import type { ChatMessage, LlmClient } from './llm.ts';
import { executeTool, toolSchemas, type Scope, type ToolContext } from './tools.ts';

export type RouterMode = 'tools' | 'json';

export interface ShopFacts {
  name: string;
  address: string;
  phone: string | null;
  openingHours: string; // human readable, e.g. "Mon 10:00–21:00; …"
  services: string[];
  barbers: string[];
  locale: string;
}

export interface Intent { tool: string; args: Record<string, unknown> }

const RX = {
  availability: /(frei|freie|verfügbar|termin|wann|slot|available|free|when|book|appointment|opening|запис|свобод|когда|окошк|время)/i,
  whoWorks: /(wer arbeitet|wer ist (heute|morgen)|who('s| is)? work|which barbers? work|кто (работает|сегодня|завтра)|какие барберы работают|работают сегодня|работают завтра)/i,
  services: /(leistung|angebot|preis|services?|price|what do you offer|услуг|цен|прайс)/i,
  myBooking: /(mein(en)? termin|meine buchung|my (booking|appointment)|мо[яюей] запис|перенес|verschieb|umbuch|reschedul|move my)/i,
  stats: /(umsatz|statistik|einnahm|revenue|stats|statistic|earn|выручк|статистик|доход)/i,
  dayOverview: /(heute (los|geplant|gebucht)|termine heute|today'?s (bookings|schedule)|bookings today|записи (на )?сегодня|расписание (на )?сегодня|who is booked)/i,
  tomorrow: /(morgen|tomorrow|завтра)/i,
  today: /(heute|today|сегодня)/i,
};

function mentioned(list: string[], text: string): string | undefined {
  const t = text.toLowerCase();
  return list.filter((n) => n.length >= 3).sort((a, b) => b.length - a.length).find((n) => t.includes(n.toLowerCase()));
}

/** Deterministic intent → server tool, so schedule facts always come from the DB. */
export function classifyIntent(text: string, scope: Scope, facts: ShopFacts, hasBooking: boolean, today: string): Intent | null {
  const date = RX.tomorrow.test(text) ? 'tomorrow' : RX.today.test(text) ? 'today' : undefined;
  const service = mentioned(facts.services, text);
  const barber = mentioned(facts.barbers, text);
  if (scope === 'owner' && RX.stats.test(text)) {
    return { tool: 'owner_stats', args: { date_from: `${today.slice(0, 8)}01`, date_to: today, ...(barber ? { barber } : {}) } };
  }
  if (scope === 'owner' && RX.dayOverview.test(text)) return { tool: 'owner_day_overview', args: date ? { date } : {} };
  if (scope === 'client' && hasBooking && RX.myBooking.test(text)) return { tool: 'get_my_booking', args: {} };
  if (RX.whoWorks.test(text)) return { tool: 'barbers_on_date', args: date ? { date } : {} };
  if (barber && RX.services.test(text) && !RX.availability.test(text)) return { tool: 'barber_services', args: { barber } };
  if (RX.availability.test(text) && service) {
    return { tool: 'find_available_slots', args: { service, ...(barber ? { barber } : {}), ...(date ? { date_from: date } : {}), days: date ? 1 : 3 } };
  }
  if (RX.availability.test(text) || RX.services.test(text)) return { tool: 'list_services', args: {} };
  return null;
}

const LANG: Record<string, string> = { de: 'German', en: 'English', ru: 'Russian' };

export function systemPrompt(scope: Scope, facts: ShopFacts, ctx: ToolContext, mode: RouterMode): string {
  const lines = [
    `You are the AI booking assistant of the barbershop "${facts.name}". You are an AI, not a human; say so if asked.`,
    `Answer in ${LANG[facts.locale] ?? 'the language of the user'} unless the user writes in another language. Be brief and friendly.`,
    `Shop timezone: ${ctx.timezone}. Today (shop-local) is ${ctx.today}. All times are local shop times.`,
    `Address: ${facts.address}. Phone: ${facts.phone ?? '—'}. Opening hours: ${facts.openingHours}.`,
    'RULES:',
    '- Never invent or guess free times, prices, services, barbers or booking details. Use ONLY tool results from this conversation.',
    '- Before saying anything about availability or schedules, call find_available_slots / barbers_on_date.',
    '- If a tool returns an error or nothing, say so honestly and suggest the booking page.',
    '- You cannot create new bookings; for that, point to the "Book" tab. Never ask for passwords or payment data.',
    scope === 'client'
      ? '- You may move the client\'s own booking only via reschedule_my_booking after they explicitly confirm a time returned by find_available_slots (then set user_confirmed=true).'
      : '- You are helping staff. You can read schedules and statistics; you cannot change data. "Upcoming value" is expected value, not revenue.',
  ];
  if (mode === 'json') {
    lines.push(
      'OUTPUT FORMAT: reply with ONE JSON object and nothing else.',
      'To call a tool: {"tool":"<name>","args":{...}}. To answer the user: {"answer":"<text>"}.',
      `Available tools: ${toolSchemas(scope).map((t) => `${t.function.name}(${JSON.stringify((t.function.parameters as { properties?: object }).properties ?? {})}): ${t.function.description}`).join(' | ')}`,
    );
  }
  return lines.join('\n');
}

const TIME_RX = /\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/g;
export function timesIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(TIME_RX)) out.add(`${m[1]!.padStart(2, '0')}:${m[2]}`);
  return out;
}

export function guardTimes(reply: string, allowedSources: string[]): string[] {
  const allowed = new Set<string>();
  for (const s of allowedSources) for (const t of timesIn(s)) allowed.add(t);
  return [...timesIn(reply)].filter((t) => !allowed.has(t));
}

export function extractJson(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export interface RunResult { reply: string; toolsUsed: string[]; totalTokens: number; guarded: boolean; steps: number }

function fallbackFromTools(results: { name: string; result: unknown }[], locale: string): string {
  const slots = [...results].reverse().find((r) => r.name === 'find_available_slots')?.result as { days?: { date: string; times: string[] }[]; service?: string } | undefined;
  if (slots?.days?.length) {
    const head = locale === 'de' ? `Freie Zeiten für ${slots.service}:` : locale === 'ru' ? `Свободное время для «${slots.service}»:` : `Free times for ${slots.service}:`;
    return [head, ...slots.days.map((d) => `${d.date}: ${d.times.slice(0, 8).join(', ')}`)].join('\n');
  }
  return locale === 'de'
    ? 'Dazu kann ich gerade keine verlässliche Auskunft geben. Bitte nutzen Sie die Buchungsseite.'
    : locale === 'ru'
      ? 'Сейчас я не могу дать точный ответ. Пожалуйста, воспользуйтесь страницей записи.'
      : "I can't give a reliable answer right now. Please use the booking page.";
}

export async function runAssistant(opts: {
  llm: LlmClient;
  mode: RouterMode;
  ctx: ToolContext;
  facts: ShopFacts;
  history: { role: 'user' | 'assistant'; content: string }[];
  maxSteps?: number;
}): Promise<RunResult> {
  const { llm, mode, ctx, facts } = opts;
  const maxSteps = Math.min(opts.maxSteps ?? 4, 6);
  const toolsUsed: string[] = [];
  const results: { name: string; result: unknown }[] = [];
  let totalTokens = 0;
  let steps = 0;
  const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt(ctx.scope, facts, ctx, mode) }, ...opts.history.slice(-12)];
  const lastUser = [...opts.history].reverse().find((m) => m.role === 'user')?.content ?? '';

  const runTool = async (name: string, args: unknown) => {
    const r = await executeTool(name, args, ctx);
    toolsUsed.push(name);
    results.push({ name, result: r.result });
    return r;
  };
  const injectResult = (name: string, args: unknown, result: unknown, id: string) => {
    if (mode === 'tools') {
      messages.push({ role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
      messages.push({ role: 'tool', tool_call_id: id, content: JSON.stringify(result) });
    } else {
      messages.push({ role: 'assistant', content: JSON.stringify({ tool: name, args }) });
      messages.push({ role: 'user', content: `TOOL RESULT ${name}: ${JSON.stringify(result)}` });
    }
  };

  // 1. Deterministic pre-routing.
  const intent = classifyIntent(lastUser, ctx.scope, facts, ctx.bookingToken !== null, ctx.today);
  if (intent) {
    const r = await runTool(intent.tool, intent.args);
    injectResult(intent.tool, intent.args, r.result, 'pre_0');
  }

  // 2. Bounded loop.
  let reply: string | null = null;
  while (steps < maxSteps && reply === null) {
    steps++;
    const res = await llm.chat({
      messages,
      ...(mode === 'tools' ? { tools: toolSchemas(ctx.scope), tool_choice: steps < maxSteps ? ('auto' as const) : ('none' as const) } : {}),
      max_tokens: 600,
    });
    totalTokens += res.totalTokens;
    const msg = res.message;
    if (mode === 'tools') {
      if (msg.tool_calls?.length) {
        messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls.slice(0, 3) });
        for (const call of msg.tool_calls.slice(0, 3)) {
          let args: unknown = {};
          try {
            args = JSON.parse(call.function.arguments || '{}');
          } catch {
            args = { __invalid_json: true };
          }
          const r = await runTool(call.function.name, args);
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(r.result) });
        }
        continue;
      }
      reply = msg.content ?? '';
    } else {
      const parsed = extractJson(msg.content);
      if (parsed && typeof parsed.tool === 'string') {
        const r = await runTool(parsed.tool, parsed.args ?? {});
        injectResult(parsed.tool, parsed.args ?? {}, r.result, `json_${steps}`);
        continue;
      }
      reply = parsed && typeof parsed.answer === 'string' ? parsed.answer : (msg.content ?? '');
    }
  }
  if (reply === null) reply = fallbackFromTools(results, facts.locale);

  // 3. Guard: no times that the tools/facts did not produce.
  const sources = [JSON.stringify(results), facts.openingHours, ...opts.history.filter((h) => h.role === 'user').map((h) => h.content)];
  let bad = guardTimes(reply, sources);
  let guarded = false;
  if (bad.length > 0) {
    guarded = true;
    messages.push({ role: 'assistant', content: reply });
    messages.push({
      role: mode === 'tools' ? 'system' : 'user',
      content: `Your answer contains times not returned by any tool (${bad.join(', ')}). Rewrite it using ONLY tool results.${mode === 'json' ? ' Reply as {"answer":"..."}.' : ''}`,
    });
    const retry = await llm.chat({ messages, ...(mode === 'tools' ? { tools: toolSchemas(ctx.scope), tool_choice: 'none' as const } : {}), max_tokens: 600 });
    totalTokens += retry.totalTokens;
    const text = mode === 'json' ? ((extractJson(retry.message.content)?.answer as string | undefined) ?? retry.message.content ?? '') : (retry.message.content ?? '');
    bad = guardTimes(text, sources);
    reply = bad.length === 0 && text.trim() ? text : fallbackFromTools(results, facts.locale);
  }
  return { reply: reply.trim() || fallbackFromTools(results, facts.locale), toolsUsed, totalTokens, guarded, steps };
}
