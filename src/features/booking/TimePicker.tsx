import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon } from '@astryxdesign/core/Icon';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { CalendarX2, ChevronRight } from 'lucide-react';
import { publicApi } from '@/lib/api/public';
import { useTenant } from '@/app/tenant';
import { useI18n } from '@/lib/i18n';
import { addDays, fmtDateLong, fmtWeekdayShort } from '@/lib/time';
import { cn } from '@/lib/utils';
import { Empty, ErrorState } from '@/components/States';

const PAGE = 14;

/**
 * Date strip + slot grid. Slots come only from the server
 * (get_available_slots), which applies durations, schedules, breaks,
 * vacations, blocks, existing bookings, lead time and the tenant timezone.
 * The final check happens again inside the booking transaction.
 */
export function TimePicker({
  serviceId,
  barberId,
  date,
  selected,
  onDateChange,
  onSelect,
}: {
  serviceId: string;
  barberId: string | null;
  date: string | null;
  selected: string | null;
  onDateChange: (date: string) => void;
  onSelect: (startsAt: string, localTime: string, date: string) => void;
}) {
  const { slug, shop, intl } = useTenant();
  const { t } = useI18n();
  const [from, setFrom] = useState<string>(shop.today);

  const datesQ = useQuery({
    queryKey: ['dates', slug, serviceId, barberId, from],
    queryFn: () => publicApi.dates(slug, serviceId, barberId, from, PAGE),
  });

  // Default to the first date with free time once the strip loads.
  useEffect(() => {
    if (date || !datesQ.data) return;
    const first = datesQ.data.dates.find((d) => d.slots > 0);
    if (first) onDateChange(first.date);
  }, [date, datesQ.data, onDateChange]);

  const activeDate = date ?? null;
  const slotsQ = useQuery({
    queryKey: ['slots', slug, serviceId, barberId, activeDate],
    queryFn: () => publicApi.slots(slug, serviceId, barberId, activeDate as string),
    enabled: activeDate !== null,
    refetchInterval: 60_000,
  });

  const groups = useMemo(() => {
    const slots = slotsQ.data?.slots ?? [];
    const g: { key: 'book.morning' | 'book.afternoon' | 'book.evening'; items: typeof slots }[] = [
      { key: 'book.morning', items: [] },
      { key: 'book.afternoon', items: [] },
      { key: 'book.evening', items: [] },
    ];
    for (const s of slots) {
      const h = Number(s.local_time.slice(0, 2));
      (h < 12 ? g[0] : h < 17 ? g[1] : g[2])!.items.push(s);
    }
    return g.filter((x) => x.items.length > 0);
  }, [slotsQ.data]);

  const nextFree = useMemo(
    () => datesQ.data?.dates.find((d) => d.slots > 0 && activeDate !== null && d.date > activeDate),
    [datesQ.data, activeDate],
  );
  const canPageForward = datesQ.data ? addDays(from, PAGE) <= datesQ.data.max_date : false;

  return (
    <VStack gap={4}>
      <VStack gap={2}>
        <Text type="label" id="dates-label">{t('book.datesLabel')}</Text>
        {datesQ.isPending ? (
          <HStack gap={2}>{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} index={i} width={64} height={72} />)}</HStack>
        ) : datesQ.isError ? (
          <ErrorState error={datesQ.error} onRetry={() => void datesQ.refetch()} />
        ) : (
          <div role="listbox" aria-labelledby="dates-label" className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 pb-1" data-testid="date-strip">
            {from > shop.today ? (
              <Button label={t('cal.prev')} size="sm" variant="ghost" onClick={() => setFrom(addDays(from, -PAGE) < shop.today ? shop.today : addDays(from, -PAGE))} />
            ) : null}
            {datesQ.data.dates.map((d) => {
              const isSel = d.date === activeDate;
              const day = Number(d.date.slice(8, 10));
              return (
                <button
                  key={d.date}
                  type="button"
                  role="option"
                  aria-selected={isSel}
                  data-date={d.date}
                  onClick={() => onDateChange(d.date)}
                  className={cn(
                    'flex min-h-18 w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border text-sm transition-colors',
                    isSel ? 'border-accent-bg bg-accent-bg text-on-accent' : 'border-border bg-surface text-primary',
                    d.slots === 0 && !isSel && 'text-secondary',
                  )}
                >
                  <span className="text-xs uppercase">{fmtWeekdayShort(d.date, intl)}</span>
                  <span className="text-lg font-semibold tabular-nums">{day}</span>
                  <span className={cn('text-xs', d.slots === 0 && 'line-through')}>
                    {d.slots > 0 ? t('book.slotsCount', { n: d.slots }) : t('book.full')}
                  </span>
                </button>
              );
            })}
            {canPageForward ? (
              <Button
                label={t('cal.next')}
                size="sm"
                variant="ghost"
                icon={<Icon icon={ChevronRight} />}
                isIconOnly
                onClick={() => setFrom(addDays(from, PAGE))}
              />
            ) : null}
          </div>
        )}
      </VStack>

      {activeDate ? (
        <VStack gap={3} aria-live="polite">
          <Heading level={3}>{t('book.slotsFor', { date: fmtDateLong(activeDate, intl) })}</Heading>
          {slotsQ.isPending ? (
            <div className="grid grid-cols-4 gap-2">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} index={i} height={44} />)}</div>
          ) : slotsQ.isError ? (
            <ErrorState error={slotsQ.error} onRetry={() => void slotsQ.refetch()} />
          ) : groups.length === 0 ? (
            <Empty
              title={t('book.noSlots')}
              description={t('book.noSlotsHint')}
              icon={<Icon icon={CalendarX2} />}
              actions={
                nextFree ? (
                  <Button label={t('book.nextFree', { date: fmtDateLong(nextFree.date, intl) })} onClick={() => onDateChange(nextFree.date)} />
                ) : undefined
              }
            />
          ) : (
            groups.map((g) => (
              <VStack key={g.key} gap={2}>
                <Text type="supporting">{t(g.key)}</Text>
                <div className="grid grid-cols-4 gap-2" data-testid="slot-grid">
                  {g.items.map((s) => {
                    const isSel = s.starts_at === selected;
                    return (
                      <button
                        key={s.starts_at}
                        type="button"
                        aria-pressed={isSel}
                        data-slot-time={s.local_time}
                        onClick={() => onSelect(s.starts_at, s.local_time, activeDate)}
                        className={cn(
                          'min-h-11 rounded-lg border text-sm font-medium tabular-nums transition-colors',
                          isSel ? 'border-accent-bg bg-accent-bg text-on-accent' : 'border-border bg-surface text-primary hover:border-border-strong',
                        )}
                      >
                        {s.local_time}
                      </button>
                    );
                  })}
                </div>
              </VStack>
            ))
          )}
        </VStack>
      ) : datesQ.data && datesQ.data.dates.every((d) => d.slots === 0) ? (
        <Empty title={t('book.noDates')} description={t('book.noSlotsHint')} icon={<Icon icon={CalendarX2} />} />
      ) : null}
    </VStack>
  );
}
