import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';

/**
 * Browser Supabase client (anon key only). One client per tenant slug so the
 * owner auth session is stored under a tenant-specific key and logging out of
 * one shop never touches another shop's session on the same device.
 */
const clients = new Map<string, SupabaseClient>();

export function getSupabase(slug: string): SupabaseClient {
  let c = clients.get(slug);
  if (!c) {
    c = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: {
        storageKey: `bk-auth-${slug}`,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
      global: { headers: { 'x-client-info': 'barbershop-pwa' } },
    });
    clients.set(slug, c);
  }
  return c;
}
