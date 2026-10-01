/**
 * Domain errors raised by SQL functions arrive as PostgREST errors with the
 * machine code in `message` (see private.fail) and an optional detail.
 */
export type ErrorCode =
  | 'tenant_not_found'
  | 'service_not_found'
  | 'barber_not_found'
  | 'barber_not_eligible'
  | 'slot_unavailable'
  | 'invalid_name'
  | 'invalid_phone'
  | 'invalid_email'
  | 'invalid_input'
  | 'idempotency_mismatch'
  | 'rate_limited'
  | 'booking_not_found'
  | 'booking_not_active'
  | 'policy_violation'
  | 'block_conflict'
  | 'schedule_overlap'
  | 'forbidden'
  | 'not_authenticated'
  | 'not_ready'
  | 'invalid_transition'
  | 'customer_not_found'
  | 'photo_not_found'
  | 'network'
  | 'unknown';

const KNOWN = new Set<string>([
  'tenant_not_found', 'service_not_found', 'barber_not_found', 'barber_not_eligible', 'slot_unavailable',
  'invalid_name', 'invalid_phone', 'invalid_email', 'invalid_input', 'idempotency_mismatch', 'rate_limited',
  'booking_not_found', 'booking_not_active', 'policy_violation', 'block_conflict', 'schedule_overlap',
  'forbidden', 'not_authenticated', 'not_ready', 'invalid_transition', 'customer_not_found', 'photo_not_found',
]);

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly detail: string;
  constructor(code: ErrorCode, detail = '', message?: string) {
    super(message ?? code);
    this.name = 'ApiError';
    this.code = code;
    this.detail = detail;
  }
}

interface PgLikeError {
  message?: string;
  details?: string | null;
  code?: string;
  hint?: string | null;
}

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  const e = (err ?? {}) as PgLikeError;
  const msg = typeof e.message === 'string' ? e.message : '';
  if (KNOWN.has(msg)) return new ApiError(msg as ErrorCode, e.details ?? '');
  if (e.code === '42501') return new ApiError('forbidden', msg);
  if (/fetch|network|Failed to fetch|NetworkError|Load failed/i.test(msg) || err instanceof TypeError) {
    return new ApiError('network', msg);
  }
  return new ApiError('unknown', msg);
}

/** Errors worth an automatic retry by TanStack Query. */
export function isRetryable(err: unknown): boolean {
  const e = toApiError(err);
  return e.code === 'network' || e.code === 'unknown';
}
