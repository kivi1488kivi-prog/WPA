/**
 * LOCAL STACK — a small HTTP emulator of the parts of the Supabase API this
 * project uses, backed by a real local PostgreSQL with our migrations:
 *
 *   POST /rest/v1/rpc/:fn           PostgREST-style RPC, executed as anon /
 *                                   authenticated / service_role with
 *                                   request.jwt.claims + request.headers set
 *   POST /auth/v1/token             password + refresh_token grants (GoTrue shape)
 *   GET  /auth/v1/user, POST /auth/v1/logout, POST /auth/v1/admin/users
 *   POST|PUT /storage/v1/object/:bucket/:path   upload (RLS checked in SQL)
 *   DELETE /storage/v1/object/:bucket           remove (RLS checked in SQL)
 *   GET  /storage/v1/object/public/:bucket/:path
 *   POST /functions/v1/:name        runs supabase/functions/:name/handler.ts
 *
 * It exists so that E2E tests and local development exercise the REAL SQL
 * (RLS, grants, EXCLUDE, transactions) without Docker. It is NOT Supabase and
 * passing tests here is not a substitute for checks against a real project
 * (see ACCEPTANCE.md).
 */
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { loadEnv } from '../../scripts/tenant/env.ts';
import { localKeys, signJwt, verifyJwt } from './jwt.ts';

loadEnv(); // .env.local (written by local:up) — no shell sourcing needed, works on Windows

const PORT = Number(process.env.LOCAL_STACK_PORT ?? 54321);
const DATABASE_URL = process.env.LOCAL_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/barbershop_dev';
const JWT_SECRET = process.env.LOCAL_JWT_SECRET ?? 'local-stack-jwt-secret-change-me-0123456789';
const STORAGE_DIR = path.resolve(process.env.LOCAL_STORAGE_DIR ?? '.local-stack/storage');
const ROOT = path.resolve(import.meta.dirname, '../..');

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 20 });
const keys = localKeys(JWT_SECRET);
const refreshTokens = new Map<string, string>(); // refresh -> user id

type Role = 'anon' | 'authenticated' | 'service_role';
interface Caller { role: Role; claims: Record<string, unknown> }

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, x-upsert, prefer, accept-profile, content-profile, x-forwarded-for, cache-control',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'access-control-expose-headers': 'content-range',
};

function send(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const payload = body === undefined ? '' : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...CORS, ...headers });
  res.end(payload);
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

function caller(req: http.IncomingMessage): Caller | null {
  const bearer = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const apikey = String(req.headers.apikey ?? '');
  const token = bearer || apikey;
  if (!token) return null;
  const claims = verifyJwt(token, JWT_SECRET);
  if (!claims) return null;
  const role = claims.role;
  if (role !== 'anon' && role !== 'authenticated' && role !== 'service_role') return null;
  return { role, claims };
}

function clientHeaders(req: http.IncomingMessage): string {
  const ip = (req.headers['x-forwarded-for'] as string | undefined) ?? req.socket.remoteAddress ?? 'unknown';
  return JSON.stringify({ 'x-forwarded-for': ip, 'user-agent': req.headers['user-agent'] ?? '' });
}

/** Run SQL as an API role inside one transaction, like PostgREST does. */
async function asRole<T>(c: Caller, headers: string, fn: (q: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('role', $1, true), set_config('request.jwt.claims', $2, true), set_config('request.headers', $3, true)`, [
      c.role,
      JSON.stringify(c.claims),
      headers,
    ]);
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

function pgArg(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) {
    // uuid[] / int[] / text[] arrays use PG array literals; arrays of objects are jsonb
    if (v.every((x) => typeof x !== 'object' || x === null)) {
      return `{${v.map((x) => (x === null ? 'NULL' : `"${String(x).replace(/"/g, '\\"')}"`)).join(',')}}`;
    }
    return JSON.stringify(v);
  }
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function pgError(e: unknown) {
  const err = e as { code?: string; message?: string; detail?: string; hint?: string };
  const status = err.code === '42501' ? 403 : err.code === 'P0001' ? 400 : err.code?.startsWith('23') ? 409 : 400;
  return { status, body: { code: err.code ?? 'XX000', message: err.message ?? 'error', details: err.detail ?? null, hint: err.hint ?? null } };
}

async function rpc(req: http.IncomingMessage, res: http.ServerResponse, fn: string) {
  const c = caller(req);
  if (!c) return send(res, 401, { message: 'Invalid API key', code: 'PGRST301' });
  if (!/^[a-z_][a-z0-9_]*$/.test(fn)) return send(res, 404, { message: 'not found' });
  const raw = await readBody(req);
  const args = raw.length ? (JSON.parse(raw.toString('utf8')) as Record<string, unknown>) : {};
  const names = Object.keys(args).filter((k) => /^[a-z_][a-z0-9_]*$/.test(k));
  const sql = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as r`;
  try {
    const rows = await asRole(c, clientHeaders(req), (q) => q.query(sql, names.map((n) => pgArg(args[n]))));
    const r = rows.rows[0]?.r ?? null;
    send(res, 200, JSON.stringify(r === '' ? null : r));
  } catch (e) {
    const { status, body } = pgError(e);
    send(res, status, body);
  }
}

// --- auth ---------------------------------------------------------------------
async function issueSession(userId: string, email: string) {
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = 3600;
  const access = signJwt({ sub: userId, email, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + expiresIn }, JWT_SECRET);
  const refresh = randomBytes(24).toString('base64url');
  refreshTokens.set(refresh, userId);
  return {
    access_token: access,
    token_type: 'bearer',
    expires_in: expiresIn,
    expires_at: now + expiresIn,
    refresh_token: refresh,
    user: { id: userId, aud: 'authenticated', role: 'authenticated', email, app_metadata: { provider: 'email' }, user_metadata: {}, created_at: new Date().toISOString() },
  };
}

async function auth(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const body = req.method === 'GET' ? {} : (JSON.parse((await readBody(req)).toString('utf8') || '{}') as Record<string, string>);
  if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
    const r = await pool.query(
      `select id, email from auth.users where lower(email) = lower($1) and encrypted_password = extensions.crypt($2, encrypted_password)`,
      [body.email ?? '', body.password ?? ''],
    );
    const u = r.rows[0] as { id: string; email: string } | undefined;
    if (!u) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 'invalid_credentials', msg: 'Invalid login credentials' });
    return send(res, 200, await issueSession(u.id, u.email));
  }
  if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
    const uid = refreshTokens.get(body.refresh_token ?? '');
    if (!uid) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token', code: 'refresh_token_not_found' });
    refreshTokens.delete(body.refresh_token ?? '');
    const r = await pool.query('select email from auth.users where id = $1', [uid]);
    return send(res, 200, await issueSession(uid, (r.rows[0] as { email: string }).email));
  }
  if (url.pathname === '/auth/v1/user' && req.method === 'GET') {
    const c = caller(req);
    if (!c || c.role !== 'authenticated') return send(res, 401, { message: 'invalid JWT' });
    return send(res, 200, { id: c.claims.sub, email: c.claims.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} });
  }
  if (url.pathname === '/auth/v1/logout') return send(res, 204, undefined);
  if (url.pathname === '/auth/v1/admin/users' && req.method === 'POST') {
    const c = caller(req);
    if (!c || c.role !== 'service_role') return send(res, 403, { message: 'service_role required' });
    const r = await pool.query(
      `insert into auth.users (email, encrypted_password) values (lower($1), extensions.crypt($2, extensions.gen_salt('bf')))
       on conflict (email) do update set encrypted_password = excluded.encrypted_password returning id, email`,
      [body.email, body.password ?? randomBytes(12).toString('base64url')],
    );
    return send(res, 200, r.rows[0]);
  }
  if (url.pathname === '/auth/v1/admin/users' && req.method === 'GET') {
    const c = caller(req);
    if (!c || c.role !== 'service_role') return send(res, 403, { message: 'service_role required' });
    const r = await pool.query('select id, email from auth.users order by email');
    return send(res, 200, { users: r.rows });
  }
  send(res, 404, { message: 'auth route not emulated' });
}

// --- storage -------------------------------------------------------------------
async function storage(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const pub = /^\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/.exec(url.pathname);
  if (pub && req.method === 'GET') {
    const [, bucket, key] = pub as unknown as [string, string, string];
    const b = await pool.query('select public from storage.buckets where id = $1', [bucket]);
    if (!b.rows[0]?.public) return send(res, 404, { message: 'Bucket not found' });
    const file = path.join(STORAGE_DIR, bucket, decodeURIComponent(key));
    if (!file.startsWith(path.join(STORAGE_DIR, bucket))) return send(res, 400, { message: 'bad path' });
    try {
      const data = await readFile(file);
      const meta = await pool.query('select metadata from storage.objects where bucket_id = $1 and name = $2', [bucket, decodeURIComponent(key)]);
      const type = (meta.rows[0]?.metadata as { mimetype?: string } | undefined)?.mimetype ?? 'application/octet-stream';
      res.writeHead(200, { 'content-type': type, 'cache-control': 'public, max-age=3600', ...CORS });
      return res.end(data);
    } catch {
      return send(res, 404, { message: 'Object not found' });
    }
  }
  const obj = /^\/storage\/v1\/object\/([^/]+)\/(.+)$/.exec(url.pathname);
  const c = caller(req);
  if (!c) return send(res, 401, { message: 'Invalid JWT' });
  if (obj && (req.method === 'POST' || req.method === 'PUT')) {
    const [, bucket, rawKey] = obj as unknown as [string, string, string];
    const key = decodeURIComponent(rawKey);
    let data = await readBody(req);
    let mimetype = String(req.headers['content-type'] ?? 'application/octet-stream').split(';')[0] ?? 'application/octet-stream';
    // supabase-js sends Blob/File bodies as multipart/form-data (like Storage API accepts)
    if (mimetype === 'multipart/form-data') {
      const part = parseMultipartFile(data, String(req.headers['content-type']));
      if (!part) return send(res, 400, { statusCode: '400', error: 'invalid_multipart', message: 'no file part' });
      data = part.data;
      mimetype = part.type;
    }
    const upsert = req.headers['x-upsert'] === 'true' || req.method === 'PUT';
    try {
      const bucketRow = await pool.query('select file_size_limit, allowed_mime_types from storage.buckets where id = $1', [bucket]);
      const br = bucketRow.rows[0] as { file_size_limit: number | null; allowed_mime_types: string[] | null } | undefined;
      if (!br) return send(res, 404, { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' });
      if (br.file_size_limit && data.length > br.file_size_limit) return send(res, 413, { statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' });
      if (br.allowed_mime_types && !br.allowed_mime_types.includes(mimetype)) return send(res, 415, { statusCode: '415', error: 'invalid_mime_type', message: `mime type ${mimetype} is not supported` });
      await asRole(c, clientHeaders(req), async (q) => {
        const sql = upsert
          ? `insert into storage.objects (bucket_id, name, owner, metadata) values ($1, $2, $3, $4)
             on conflict (bucket_id, name) do update set metadata = excluded.metadata, updated_at = now()`
          : `insert into storage.objects (bucket_id, name, owner, metadata) values ($1, $2, $3, $4)`;
        await q.query(sql, [bucket, key, (c.claims.sub as string | undefined) ?? null, JSON.stringify({ mimetype, size: data.length })]);
      });
      const file = path.join(STORAGE_DIR, bucket, key);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, data);
      return send(res, 200, { Key: `${bucket}/${key}`, Id: key });
    } catch (e) {
      const { body } = pgError(e);
      const code = (e as { code?: string }).code;
      if (code === '23505') return send(res, 409, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
      return send(res, 403, { statusCode: '403', error: 'Unauthorized', message: `new row violates row-level security policy (${body.message})` });
    }
  }
  const del = /^\/storage\/v1\/object\/([^/]+)$/.exec(url.pathname);
  if (del && req.method === 'DELETE') {
    const bucket = del[1] as string;
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}') as { prefixes?: string[] };
    const prefixes = body.prefixes ?? [];
    try {
      const removed = await asRole(c, clientHeaders(req), async (q) => {
        const r = await q.query('delete from storage.objects where bucket_id = $1 and name = any($2) returning name', [bucket, prefixes]);
        return r.rows as { name: string }[];
      });
      for (const r of removed) await rm(path.join(STORAGE_DIR, bucket, r.name), { force: true });
      return send(res, 200, removed.map((r) => ({ name: r.name, bucket_id: bucket })));
    } catch (e) {
      return send(res, 403, pgError(e).body);
    }
  }
  send(res, 404, { message: 'storage route not emulated' });
}

function parseMultipartFile(body: Buffer, contentType: string): { data: Buffer; type: string } | null {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const b = boundary?.[1] ?? boundary?.[2];
  if (!b) return null;
  const delim = Buffer.from(`--${b}`);
  let pos = body.indexOf(delim);
  while (pos !== -1) {
    const next = body.indexOf(delim, pos + delim.length);
    if (next === -1) break;
    const part = body.subarray(pos + delim.length + 2, next - 2); // strip CRLFs
    const sep = part.indexOf('\r\n\r\n');
    if (sep !== -1) {
      const head = part.subarray(0, sep).toString('utf8');
      if (/filename=/i.test(head) || /content-type:/i.test(head)) {
        const type = /content-type:\s*([^\r\n;]+)/i.exec(head)?.[1]?.trim() ?? 'application/octet-stream';
        return { data: Buffer.from(part.subarray(sep + 4)), type };
      }
    }
    pos = next;
  }
  return null;
}

// --- functions ---------------------------------------------------------------------
const fnEnv = {
  get: (k: string): string | undefined => {
    if (k === 'SUPABASE_URL') return process.env.SUPABASE_URL ?? `http://localhost:${PORT}`;
    if (k === 'SUPABASE_ANON_KEY') return keys.anon;
    if (k === 'SUPABASE_SERVICE_ROLE_KEY') return keys.service;
    return process.env[k];
  },
};

async function functions(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const name = url.pathname.split('/')[3] ?? '';
  if (!/^[a-z0-9-]+$/.test(name)) return send(res, 404, { message: 'function not found' });
  let mod: { handle: (r: Request, env: typeof fnEnv) => Promise<Response> };
  try {
    mod = (await import(path.join(ROOT, 'supabase/functions', name, 'handler.ts'))) as typeof mod;
  } catch (e) {
    return send(res, 404, { message: `function ${name} not found: ${(e as Error).message}` });
  }
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  if (!headers.has('x-forwarded-for')) headers.set('x-forwarded-for', req.socket.remoteAddress ?? 'unknown');
  const request = new Request(`http://localhost:${PORT}${url.pathname}${url.search}`, { method: req.method, headers, body: body as BodyInit | undefined });
  const response = await mod.handle(request, fnEnv);
  const out = Buffer.from(await response.arrayBuffer());
  const h: Record<string, string> = { ...CORS };
  response.headers.forEach((v, k) => (h[k] = v));
  res.writeHead(response.status, h);
  res.end(out);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  try {
    if (req.method === 'OPTIONS') {
      const requested = req.headers['access-control-request-headers'];
      return send(res, 204, undefined, requested ? { 'access-control-allow-headers': String(requested) } : {});
    }
    if (url.pathname === '/health') return send(res, 200, { ok: true });
    if (url.pathname.startsWith('/rest/v1/rpc/') && req.method === 'POST') return await rpc(req, res, url.pathname.slice('/rest/v1/rpc/'.length));
    if (url.pathname.startsWith('/auth/v1/')) return await auth(req, res, url);
    if (url.pathname.startsWith('/storage/v1/')) return await storage(req, res, url);
    if (url.pathname.startsWith('/functions/v1/')) return await functions(req, res, url);
    send(res, 404, { message: `route not emulated: ${req.method} ${url.pathname}` });
  } catch (e) {
    console.error('[local-stack]', e);
    send(res, 500, { message: (e as Error).message });
  }
});

server.listen(PORT, () => {
  console.log(`[local-stack] http://localhost:${PORT}  db=${DATABASE_URL.replace(/:[^:@/]+@/, ':***@')}`);
  console.log(`[local-stack] anon key:    ${keys.anon}`);
  console.log(`[local-stack] service key: ${keys.service}`);
});
