export interface FnEnv { get(name: string): string | undefined }

export const corsHeaders: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'access-control-allow-methods': 'POST, OPTIONS',
};

export function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders, ...extra } });
}

export function clientIp(req: Request): string {
  return (req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0]!.trim();
}

export function bearer(req: Request): string | null {
  const h = req.headers.get('authorization') ?? '';
  return /^Bearer\s+(.+)$/i.exec(h)?.[1] ?? null;
}

/** Decode (not verify) a JWT payload — only used to route; the DB verifies identity. */
export function jwtRole(token: string | null): string | null {
  if (!token) return null;
  try {
    const p = token.split('.')[1] ?? '';
    const s = atob(p.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (p.length % 4)) % 4));
    return (JSON.parse(s) as { role?: string }).role ?? null;
  } catch {
    return null;
  }
}
