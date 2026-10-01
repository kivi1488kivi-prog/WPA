import { z } from 'zod';

// Only public, browser-safe values. Service-role and LLM keys never live here.
const EnvSchema = z.object({
  VITE_SUPABASE_URL: z.string().url(),
  VITE_SUPABASE_ANON_KEY: z.string().min(20),
  VITE_VAPID_PUBLIC_KEY: z.string().optional().default(''),
  VITE_FUNCTIONS_URL: z.string().url().optional(),
});

const parsed = EnvSchema.safeParse(import.meta.env);

export const envError = parsed.success ? null : parsed.error.issues.map((i) => i.path.join('.')).join(', ');

export const env = parsed.success
  ? {
      supabaseUrl: parsed.data.VITE_SUPABASE_URL.replace(/\/$/, ''),
      supabaseAnonKey: parsed.data.VITE_SUPABASE_ANON_KEY,
      vapidPublicKey: parsed.data.VITE_VAPID_PUBLIC_KEY,
      functionsUrl: (parsed.data.VITE_FUNCTIONS_URL ?? `${parsed.data.VITE_SUPABASE_URL.replace(/\/$/, '')}/functions/v1`).replace(/\/$/, ''),
    }
  : { supabaseUrl: 'http://invalid.local', supabaseAnonKey: 'invalid', vapidPublicKey: '', functionsUrl: 'http://invalid.local' };
