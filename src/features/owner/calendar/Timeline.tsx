import { Ban, Check, Coffee, Lock, Plus, UserX, X } from 'lucide-react';
import type { CalBooking, Calendar } from '@/lib/api/owner';
import { useI18n, type MessageKey } from '@/lib/i18n';
import { fmtTime, minToHHMM, minutesInTz } from '@/lib/time';
import { cn } from '@/lib/utils';

export interface Column {
  key: string;
  title: string;
  subtitle?: string;
  date: string;
  barberId: string;
  color: string;
  marker: string;
}

const PX_PER_MIN = 1.2;

/**
 * Day timeline with one column per barber (day view) or per day (barber
 * view). Every state is distinguishable without color: confirmed / completed /
 * no-show / cancelled bookings, blocks, breaks and free intervals each carry an
 * icon and a text label; blocks and breaks also use distinct patterns.
 */
export function Timeline({
  cal,
  columns,
  intl,
  onBooking,
  onFree,
  onBlock,
}: {
  cal: Calendar;
  columns: Column[];
  intl: string;
  onBooking: (b: CalBooking) => void;
  onFree: (barberId: string, date: string, minute: number) => void;
  onBlock: (blockId: string) => void;
}) {
  const { t } = useI18n();
  const tz = cal.timezone;
  const dayOf = (c: Column) => cal.days.find((d) => d.date === c.date && d.barber_id === c.barberId);
  const mins = (iso: string, date: string) => {
    // minutes from local midnight of `date`, clamped to the day (multi-day blocks)
    const d = new Date(iso);
    const local = minutesInTz(d, tz);
    const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    if (localDate < date) return 0;
    if (localDate > date) return 1440;
    return local;
  };

  let start = 24 * 60;
  let end = 0;
  for (const c of columns) {
    for (const w of dayOf(c)?.work ?? []) {
      start = Math.min(start, mins(w.start, c.date));
      end = Math.max(end, mins(w.end, c.date));
    }
  }
  for (const b of cal.bookings) {
    for (const c of columns) {
      if (b.barber_id === c.barberId && b.starts_at.length) {
        start = Math.min(start, mins(b.starts_at, c.date));
        end = Math.max(end, mins(b.ends_at, c.date));
      }
    }
  }
  if (start >= end) {
    start = 9 * 60;
    end = 19 * 60;
  }
  start = Math.max(0, Math.floor(start / 60) * 60);
  end = Math.min(1440, Math.ceil(end / 60) * 60);
  const height = (end - start) * PX_PER_MIN;
  const y = (m: number) => (Math.max(start, Math.min(end, m)) - start) * PX_PER_MIN;
  const hours: number[] = [];
  for (let m = start; m <= end; m += 60) hours.push(m);

  const statusIcon = { confirmed: Check, completed: Check, no_show: UserX, cancelled: X } as const;

  return (
    <div className="flex overflow-x-auto" role="region" aria-label={t('owner.nav.calendar')}>
      {/* hour gutter */}
      <div className="sticky left-0 z-10 w-12 shrink-0 bg-body" aria-hidden>
        <div className="h-12" />
        <div className="relative" style={{ height }}>
          {hours.map((m) => (
            <span key={m} className="absolute -translate-y-2 text-xs text-secondary tabular-nums" style={{ top: y(m) }}>
              {minToHHMM(m)}
            </span>
          ))}
        </div>
      </div>
      {columns.map((c) => {
        const day = dayOf(c);
        const bookings = cal.bookings.filter((b) => b.barber_id === c.barberId && mins(b.starts_at, c.date) < 1440 && mins(b.ends_at, c.date) > 0);
        const blocks = cal.blocks.filter(
          (bl) => (bl.barber_id === null || bl.barber_id === c.barberId) && mins(bl.starts_at, c.date) < 1440 && mins(bl.ends_at, c.date) > 0,
        );
        const off = (day?.work.length ?? 0) === 0;
        return (
          <section key={c.key} className="min-w-44 flex-1 border-l border-border" aria-label={`${c.title} ${c.subtitle ?? ''}`}>
            <header className="sticky top-0 z-10 flex h-12 items-center gap-2 border-b border-border bg-body px-2">
              <span
                className="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-body"
                style={{ backgroundColor: c.color }}
                aria-hidden
              >
                {c.marker || c.title.slice(0, 1)}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{c.title}</span>
                {c.subtitle ? <span className="block truncate text-xs text-secondary">{c.subtitle}</span> : null}
              </span>
            </header>
            <ol className="relative list-none" style={{ height }} aria-label={c.title}>
              {/* hour lines */}
              {hours.map((m) => (
                <li key={`h${m}`} aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-border/40" style={{ top: y(m) }} />
              ))}
              {off ? (
                <li className="absolute inset-x-1 top-2 flex items-center gap-1 rounded-md border border-dashed border-border p-2 text-xs text-secondary">
                  <Ban size={14} aria-hidden /> {t('cal.kind.off')}
                </li>
              ) : null}
              {/* free intervals: dashed, labelled, click to create a booking */}
              {(day?.free ?? []).map((f) => {
                const a = mins(f.start, c.date);
                const b = mins(f.end, c.date);
                if (b - a < 10) return null;
                return (
                  <li key={`f${f.start}`} className="absolute inset-x-1" style={{ top: y(a), height: y(b) - y(a) }}>
                    <button
                      type="button"
                      onClick={() => onFree(c.barberId, c.date, a)}
                      className="group flex h-full w-full items-start gap-1 rounded-md border border-dashed border-border/70 px-1.5 py-1 text-start text-xs text-secondary hover:border-accent-bg hover:text-primary"
                      aria-label={`${t('cal.newBooking')}: ${c.title}, ${t('cal.freeFrom', { from: minToHHMM(a), to: minToHHMM(b) })}`}
                    >
                      <Plus size={12} aria-hidden className="mt-0.5 shrink-0" />
                      <span>{t('cal.freeFrom', { from: minToHHMM(a), to: minToHHMM(b) })}</span>
                    </button>
                  </li>
                );
              })}
              {(day?.breaks ?? []).map((br) => {
                const a = mins(br.start, c.date);
                const b = mins(br.end, c.date);
                return (
                  <li
                    key={`b${br.start}`}
                    className="absolute inset-x-1 flex items-start gap-1 overflow-hidden rounded-md border border-border bg-[repeating-linear-gradient(45deg,transparent,transparent_6px,var(--color-background-muted)_6px,var(--color-background-muted)_8px)] px-1.5 py-1 text-xs text-secondary"
                    style={{ top: y(a), height: Math.max(y(b) - y(a), 18) }}
                  >
                    <Coffee size={12} aria-hidden className="mt-0.5 shrink-0" />
                    <span>
                      {t('cal.kind.break')} {minToHHMM(a)}–{minToHHMM(b)}
                    </span>
                  </li>
                );
              })}
              {blocks.map((bl) => {
                const a = mins(bl.starts_at, c.date);
                const b = mins(bl.ends_at, c.date);
                return (
                  <li key={`k${bl.id}`} className="absolute inset-x-1" style={{ top: y(a), height: Math.max(y(b) - y(a), 22) }}>
                    <button
                      type="button"
                      onClick={() => onBlock(bl.id)}
                      className="flex h-full w-full items-start gap-1 overflow-hidden rounded-md border-2 border-border-strong bg-[repeating-linear-gradient(-45deg,var(--color-background-muted),var(--color-background-muted)_4px,transparent_4px,transparent_10px)] px-1.5 py-1 text-start text-xs font-medium text-primary"
                    >
                      <Lock size={12} aria-hidden className="mt-0.5 shrink-0" />
                      <span>
                        {t('cal.kind.block')}: {t(`block.kind.${bl.kind}` as MessageKey)}
                        {bl.note ? ` · ${bl.note}` : ''}
                      </span>
                    </button>
                  </li>
                );
              })}
              {bookings.map((bk) => {
                const a = mins(bk.starts_at, c.date);
                const b = mins(bk.ends_at, c.date);
                const Icon = statusIcon[bk.status];
                const cancelled = bk.status === 'cancelled';
                return (
                  <li key={bk.id} className={cn('absolute', cancelled ? 'right-1 left-1/2' : 'inset-x-1')} style={{ top: y(a), height: Math.max(y(b) - y(a), 26) }}>
                    <button
                      type="button"
                      onClick={() => onBooking(bk)}
                      data-testid={`cal-booking-${bk.id}`}
                      className={cn(
                        'flex h-full w-full flex-col overflow-hidden rounded-md border-l-4 px-1.5 py-1 text-start text-xs shadow-sm',
                        cancelled ? 'border border-dashed border-border bg-body text-secondary' : 'bg-surface text-primary',
                        bk.status === 'completed' && 'opacity-80',
                      )}
                      style={{ borderLeftColor: c.color }}
                    >
                      <span className="flex items-center gap-1 font-semibold">
                        <Icon size={12} aria-hidden />
                        <span className={cn('tabular-nums', cancelled && 'line-through')}>{fmtTime(bk.starts_at, tz, intl)}</span>
                        <span className="sr-only">{t(`cal.kind.${bk.status}` as MessageKey)}</span>
                        <span className="truncate">{bk.customer_name}</span>
                      </span>
                      <span className={cn('truncate', cancelled && 'line-through')}>{bk.service_name}</span>
                      <span className="truncate text-secondary">
                        {t(`cal.kind.${bk.status}` as MessageKey)}
                        {bk.is_demo ? ` · ${t('cal.demo')}` : ''}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
