import { isoWeekday, minToHHMM, minutesInTz, todayIn, addDays } from './time';

export interface Interval { weekday: number; start_min: number; end_min: number }

export type OpenState =
  | { kind: 'open'; until: string }
  | { kind: 'closed'; nextDayOffset: number | null; nextWeekday: number | null; opensAt: string | null };

/** Open/closed state of a shop "now" in its own timezone. */
export function openState(hours: Interval[], tz: string, now: Date = new Date()): OpenState {
  const today = todayIn(tz, now);
  const minute = minutesInTz(now, tz);
  const dow = isoWeekday(today);
  const todays = hours.filter((h) => h.weekday === dow).sort((a, b) => a.start_min - b.start_min);
  const current = todays.find((h) => minute >= h.start_min && minute < h.end_min);
  if (current) {
    // merge adjacent intervals for the "until" label
    let end = current.end_min;
    for (const h of todays) if (h.start_min === end) end = h.end_min;
    return { kind: 'open', until: minToHHMM(end % 1440) };
  }
  for (let off = 0; off < 8; off++) {
    const d = addDays(today, off);
    const wd = isoWeekday(d);
    const next = hours
      .filter((h) => h.weekday === wd && (off > 0 || h.start_min > minute))
      .sort((a, b) => a.start_min - b.start_min)[0];
    if (next) return { kind: 'closed', nextDayOffset: off, nextWeekday: wd, opensAt: minToHHMM(next.start_min) };
  }
  return { kind: 'closed', nextDayOffset: null, nextWeekday: null, opensAt: null };
}

/** Human weekday name for ISO weekday 1..7. */
export function weekdayName(weekday: number, locale: string, style: 'long' | 'short' = 'long'): string {
  // 2024-01-01 is a Monday.
  const d = new Date(Date.UTC(2024, 0, weekday));
  return new Intl.DateTimeFormat(locale, { weekday: style, timeZone: 'UTC' }).format(d);
}

export function formatDayHours(hours: Interval[], weekday: number): string | null {
  const list = hours.filter((h) => h.weekday === weekday).sort((a, b) => a.start_min - b.start_min);
  if (list.length === 0) return null;
  return list.map((h) => `${minToHHMM(h.start_min)}–${minToHHMM(h.end_min)}`).join(', ');
}
