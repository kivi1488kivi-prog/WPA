// Time helpers. All business times are interpreted in the TENANT timezone,
// never the device timezone. Dates are ISO "YYYY-MM-DD" strings (local to tenant).

export function addDays(isoDate: string, n: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function diffDays(a: string, b: string): number {
  const pa = Date.parse(`${a}T00:00:00Z`);
  const pb = Date.parse(`${b}T00:00:00Z`);
  return Math.round((pa - pb) / 86_400_000);
}

/** ISO weekday 1..7 (Mon..Sun) of a calendar date. */
export function isoWeekday(isoDate: string): number {
  const d = new Date(`${isoDate}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

export function startOfIsoWeek(isoDate: string): string {
  return addDays(isoDate, 1 - isoWeekday(isoDate));
}

/** Current calendar date in a timezone. */
export function todayIn(tz: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Minutes since local midnight of an instant in a timezone. */
export function minutesInTz(instant: string | Date, tz: string): number {
  const d = typeof instant === 'string' ? new Date(instant) : instant;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

export function dateInTz(instant: string | Date, tz: string): string {
  return todayIn(tz, typeof instant === 'string' ? new Date(instant) : instant);
}

export function fmtTime(instant: string | Date, tz: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
    typeof instant === 'string' ? new Date(instant) : instant,
  );
}

export function fmtDateLong(isoDate: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(
    new Date(`${isoDate}T12:00:00Z`),
  );
}

export function fmtDateShort(isoDate: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(`${isoDate}T12:00:00Z`));
}

export function fmtWeekdayShort(isoDate: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'short' }).format(new Date(`${isoDate}T12:00:00Z`));
}

export function fmtDateTime(instant: string, tz: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: tz, weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(instant));
}

export function minToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function hhmmToMin(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(v);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 24 || mi > 59 || (h === 24 && mi > 0)) return null;
  return h * 60 + mi;
}

/**
 * Instant for a local wall-clock time in a timezone (DST aware). Works by
 * iterating on the offset the zone reports for the candidate instant.
 */
export function zonedToUtc(isoDate: string, minutes: number, tz: string): Date {
  const [y, mo, d] = isoDate.split('-').map(Number) as [number, number, number];
  const wallUtc = Date.UTC(y, mo - 1, d, 0, minutes);
  let guess = wallUtc;
  for (let i = 0; i < 3; i++) {
    const off = tzOffsetMinutes(new Date(guess), tz);
    const next = wallUtc - off * 60_000;
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}

export function tzOffsetMinutes(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

export function fmtHoursFromMinutes(min: number, locale: string): string {
  if (min % 60 === 0) {
    return new Intl.NumberFormat(locale, { style: 'unit', unit: 'hour', unitDisplay: 'long' }).format(min / 60);
  }
  return new Intl.NumberFormat(locale, { style: 'unit', unit: 'minute', unitDisplay: 'long' }).format(min);
}
