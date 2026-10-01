import http from 'node:http';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import pg from 'pg';
import { FAKE_LLM_PORT, parseEnv } from './global-setup.ts';

export const ENV = parseEnv();
export const URL_ = ENV.SUPABASE_URL!;
const opts = { auth: { persistSession: false, autoRefreshToken: false } } as const;
export const anon = (): SupabaseClient => createClient(URL_, ENV.SUPABASE_ANON_KEY!, opts);
export const service = (): SupabaseClient => createClient(URL_, ENV.SUPABASE_SERVICE_ROLE_KEY!, opts);
export const pool = new pg.Pool({ connectionString: ENV.LOCAL_DATABASE_URL, max: 4 });

export async function signIn(email: string): Promise<{ client: SupabaseClient; token: string }> {
  const client = createClient(URL_, ENV.SUPABASE_ANON_KEY!, opts);
  const { data, error } = await client.auth.signInWithPassword({ email, password: 'demo-password-123' });
  if (error || !data.session) throw error ?? new Error('no session');
  return { client, token: data.session.access_token };
}

export async function tenantId(slug: string): Promise<string> {
  return (await pool.query('select id from public.tenants where slug = $1', [slug])).rows[0].id as string;
}

/** OpenAI-compatible fake LLM. Behaviour switchable per test. */
export const fakeLlm = {
  mode: 'echo-tools' as 'echo-tools' | 'down' | 'invent',
  requests: [] as unknown[],
  server: null as http.Server | null,
  async start() {
    this.server = http.createServer(async (req, res) => {
      let body = '';
      for await (const c of req) body += c;
      const parsed = JSON.parse(body || '{}') as { messages: { role: string; content: string | null }[] };
      this.requests.push(parsed);
      if (this.mode === 'down') {
        res.writeHead(500);
        return res.end('{}');
      }
      const toolText = parsed.messages.filter((m) => m.role === 'tool').map((m) => m.content ?? '').join(' ');
      const times = [...toolText.matchAll(/\b\d{2}:\d{2}\b/g)].map((m) => m[0]).slice(0, 3);
      const content = this.mode === 'invent' ? 'Frei um 05:55.' : times.length ? `Freie Zeiten: ${times.join(', ')}` : 'Hallo!';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }], usage: { total_tokens: 123 } }));
    });
    await new Promise<void>((r) => this.server!.listen(FAKE_LLM_PORT, r));
  },
  async stop() {
    await new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
  },
};

export async function aiChat(body: Record<string, unknown>, token = ENV.SUPABASE_ANON_KEY!) {
  const res = await fetch(`${URL_}/functions/v1/ai-chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: ENV.SUPABASE_ANON_KEY!, authorization: `Bearer ${token}`, 'x-forwarded-for': `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}
