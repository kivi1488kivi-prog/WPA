import { describe, expect, it } from 'vitest';
import { addDays, dateInTz, fmtTime, hhmmToMin, isoWeekday, minToHHMM, minutesInTz, startOfIsoWeek, todayIn, zonedToUtc } from '@/lib/time';
import { openState } from '@/lib/hours';
import { buildIcs } from '@/lib/ics';
import { fmtMoney, parseMoneyToCents } from '@/lib/money';

describe('timezone helpers', () => {
  it('converts local wall time to UTC in Berlin summer and winter', () => {
    expect(zonedToUtc('2026-07-01', 600, 'Europe/Berlin').toISOString()).toBe('2026-07-01T08:00:00.000Z');
    expect(zonedToUtc('2026-12-01', 600, 'Europe/Berlin').toISOString()).toBe('2026-12-01T09:00:00.000Z');
  });
  it('handles DST transition days (Berlin 2026-10-25, New York 2026-11-01)', () => {
    expect(zonedToUtc('2026-10-25', 600, 'Europe/Berlin').toISOString()).toBe('2026-10-25T09:00:00.000Z');
    expect(zonedToUtc('2026-11-01', 9 * 60, 'America/New_York').toISOString()).toBe('2026-11-01T14:00:00.000Z');
    expect(zonedToUtc('2026-03-29', 600, 'Europe/Berlin').toISOString()).toBe('2026-03-29T08:00:00.000Z');
  });
  it('derives local date/time of an instant per tenant timezone', () => {
    const i = '2026-10-05T22:30:00Z';
    expect(dateInTz(i, 'Europe/Berlin')).toBe('2026-10-06');
    expect(dateInTz(i, 'America/New_York')).toBe('2026-10-05');
    expect(minutesInTz(i, 'Europe/Berlin')).toBe(30);
    expect(fmtTime(i, 'America/New_York', 'de-DE')).toBe('18:30');
    expect(todayIn('Pacific/Kiritimati', new Date('2026-10-05T12:00:00Z'))).toBe('2026-10-06');
  });
  it('date arithmetic and weekdays', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(isoWeekday('2026-10-05')).toBe(1);
    expect(startOfIsoWeek('2026-10-11')).toBe('2026-10-05');
    expect(minToHHMM(545)).toBe('09:05');
    expect(hhmmToMin('24:00')).toBe(1440);
    expect(hhmmToMin('25:00')).toBeNull();
  });
});

describe('opening state', () => {
  const hours = [
    { weekday: 1, start_min: 600, end_min: 840 },
    { weekday: 1, start_min: 840, end_min: 1200 },
    { weekday: 2, start_min: 600, end_min: 1200 },
  ];
  it('open with merged adjacent intervals', () => {
    expect(openState(hours, 'Europe/Berlin', new Date('2026-10-05T10:00:00Z'))).toEqual({ kind: 'open', until: '20:00' });
  });
  it('closed: next opening', () => {
    const s = openState(hours, 'Europe/Berlin', new Date('2026-10-05T19:30:00Z'));
    expect(s).toMatchObject({ kind: 'closed', nextDayOffset: 1, opensAt: '10:00' });
  });
});

describe('ics', () => {
  it('builds a valid single-event calendar in UTC with sequence', () => {
    const ics = buildIcs({ uid: 'abc', version: 3, startsAt: '2026-10-05T08:00:00Z', endsAt: '2026-10-05T08:45:00Z', title: 'Cut; Shop', description: 'Line1\nLine2', location: 'Street 1, Berlin', url: 'https://x.test/b#t' }, new Date('2026-10-01T00:00:00Z'));
    expect(ics).toContain('DTSTART:20261005T080000Z');
    expect(ics).toContain('SEQUENCE:3');
    expect(ics).toContain('SUMMARY:Cut\; Shop');
    expect(ics).toContain('DESCRIPTION:Line1\\nLine2');
    expect(ics.split('\r\n').every((l) => l.length <= 75)).toBe(true);
  });
});

describe('money', () => {
  it('formats and parses', () => {
    expect(fmtMoney(3500, 'EUR', 'de-DE')).toMatch(/35\s?€/);
    expect(parseMoneyToCents('12,50')).toBe(1250);
    expect(parseMoneyToCents('abc')).toBeNull();
  });
});
