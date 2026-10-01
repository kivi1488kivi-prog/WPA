// Supabase Edge Function entry (Deno). Logic lives in handler.ts (runtime-agnostic).
import { handle } from './handler.ts';

Deno.serve((req) => handle(req, { get: (k) => Deno.env.get(k) }));
