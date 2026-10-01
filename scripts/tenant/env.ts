import { existsSync } from 'node:fs';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ROOT } from './lib.ts';

/** Loads .env / .env.local (Node 22 built-in parser) for server-side scripts. */
export function loadEnv(): void {
  for (const f of ['.env.local', '.env']) {
    const p = path.join(ROOT, f);
    if (existsSync(p)) process.loadEnvFile(p);
  }
}

export function adminClient(): SupabaseClient {
  loadEnv();
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY (server-side only, never VITE_*). See .env.example.');
    process.exit(2);
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function anonClient(): SupabaseClient {
  loadEnv();
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL / SUPABASE_ANON_KEY.');
    process.exit(2);
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function args() {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((a) => a.startsWith('--')).map((a) => a.replace(/=.*$/, '')));
  const values = Object.fromEntries(argv.filter((a) => a.startsWith('--') && a.includes('=')).map((a) => [a.slice(2, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]));
  const positional = argv.filter((a) => !a.startsWith('--'));
  return { flags, values, positional };
}
