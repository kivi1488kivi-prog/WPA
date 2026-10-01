/**
 * Idempotency keys survive reloads during one attempt (sessionStorage) so a
 * retry after a network failure reuses the key and the server returns the
 * same booking and the same access token instead of creating a duplicate.
 */
const mem = new Map<string, string>();

export function newKey(): string {
  return crypto.randomUUID();
}

export function attemptKey(scope: string): string {
  const k = `bk-idem:${scope}`;
  try {
    const existing = sessionStorage.getItem(k);
    if (existing) return existing;
    const fresh = newKey();
    sessionStorage.setItem(k, fresh);
    return fresh;
  } catch {
    const existing = mem.get(k);
    if (existing) return existing;
    const fresh = newKey();
    mem.set(k, fresh);
    return fresh;
  }
}

export function clearAttemptKey(scope: string): void {
  const k = `bk-idem:${scope}`;
  mem.delete(k);
  try {
    sessionStorage.removeItem(k);
  } catch {
    /* storage unavailable: memory copy already removed */
  }
}
