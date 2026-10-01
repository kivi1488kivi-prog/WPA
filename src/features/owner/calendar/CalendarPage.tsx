import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { List, ListItem } from '@astryxdesign/core/List';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { Ban, Check, ChevronLeft, ChevronRight, Coffee, Lock, Plus, UserX, X } from 'lucide-react';
import { useTenant } from '@/app/tenant';
import { useI18n, type MessageKey } from '@/lib/i18n';
import { addDays, fmtDateLong, fmtDateShort, fmtTime, fmtWeekdayShort, minToHHMM, startOfIsoWeek } from '@/lib/time';
import type { CalBooking, Calendar } from '@/lib/api/owner';
import { ErrorState, ListSkeleton } from '@/components/States';
import { can, useOwner } from '../context';
import { PageHeader } from '../ui';
import { Timeline, type Column } from './Timeline';
import { BookingSheet } from './BookingSheet';
import { NewBookingSheet, type NewBookingPrefill } from './NewBookingSheet';
import { BlockDeleteDialog, BlockSheet } from './BlockSheet';

type View = 'day' | 'week' | 'barber';

export function CalendarPage() {
  const { intl } = useTenant();
  const { t } = useI18n();
  const { api, workspace, role, myBarberId, tenantId } = useOwner();
  const allowedAll = can(role, 'allBarbers');
  const activeBarbers = workspace.barbers.filter((b) => b.is_active);
  const [view, setView] = useState<View>('day');
  const [date, setDate] = useState(workspace.today);
  const [barberFilter, setBarberFilter] = useState<string | null>(allowedAll ? null : myBarberId);
  const [openBooking, setOpenBooking] = useState<CalBooking | null>(null);
  const [newBooking, setNewBooking] = useState<NewBookingPrefill | null>(null);
  const [blockOpen, setBlockOpen] = useState(false);
  const [blockId, setBlockId] = useState<string | null>(null);

  const barberForView = view === 'barber' ? (barberFilter ?? myBarberId ?? activeBarbers[0]?.id ?? null) : barberFilter;
  const from = view === 'day' ? date : startOfIsoWeek(date);
  const to = view === 'day' ? date : addDays(from, 6);

  const q = useQuery({
    queryKey: ['owner', tenantId, 'calendar', from, to, barberForView],
    queryFn: () => api.calendar(from, to, barberForView),
    refetchInterval: 60_000,
  });

  const columns: Column[] = useMemo(() => {
    const cal = q.data;
    if (!cal) return [];
    if (view === 'day') {
      return cal.barbers
        .filter((b) => b.is_active || cal.bookings.some((x) => x.barber_id === b.id))
        .map((b) => ({ key: b.id, title: b.name, date, barberId: b.id, color: b.color, marker: b.marker }));
    }
    const b = cal.barbers.find((x) => x.id === barberForView);
    if (!b) return [];
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(from, i);
      return { key: d, title: `${fmtWeekdayShort(d, intl)} ${fmtDateShort(d, intl)}`, subtitle: b.name, date: d, barberId: b.id, color: b.color, marker: b.marker };
    });
  }, [q.data, view, date, from, barberForView, intl]);

  const step = view === 'day' ? 1 : 7;
  const rangeLabel = view === 'day' ? fmtDateLong(date, intl) : `${fmtDateShort(from, intl)} – ${fmtDateShort(to, intl)}`;
  const barberOptions = [
    ...(view !== 'barber' && allowedAll ? [{ value: '', label: t('cal.allBarbers') }] : []),
    ...workspace.barbers.filter((b) => allowedAll || b.id === myBarberId).map((b) => ({ value: b.id, label: b.is_active ? b.name : `${b.name} (${t('barbers.inactive')})` })),
  ];

  return (
    <VStack gap={0}>
      <PageHeader
        title={t('owner.nav.calendar')}
        subtitle={rangeLabel}
        actions={
          <>
            <Button label={t('cal.newBooking')} icon={<Icon icon={Plus} />} variant="primary" onClick={() => setNewBooking({ date })} data-testid="cal-new-booking" />
            <Button label={t('cal.newBlock')} icon={<Icon icon={Lock} />} onClick={() => setBlockOpen(true)} />
          </>
        }
      />
      <HStack gap={2} paddingInline={4} paddingBlockEnd={3} wrap="wrap" vAlign="center">
        <SegmentedControl label={t('owner.nav.calendar')} value={view} onChange={(v) => setView(v as View)} size="sm">
          <SegmentedControlItem value="day" label={t('cal.day')} />
          <SegmentedControlItem value="week" label={t('cal.week')} />
          <SegmentedControlItem value="barber" label={t('cal.barber')} />
        </SegmentedControl>
        <HStack gap={1} vAlign="center">
          <IconButton label={t('cal.prev')} tooltip={t('cal.prev')} icon={<Icon icon={ChevronLeft} />} size="sm" onClick={() => setDate(addDays(date, -step))} />
          <Button label={t('cal.today')} size="sm" onClick={() => setDate(workspace.today)} />
          <IconButton label={t('cal.next')} tooltip={t('cal.next')} icon={<Icon icon={ChevronRight} />} size="sm" onClick={() => setDate(addDays(date, step))} />
        </HStack>
        {barberOptions.length > 1 ? (
          <Selector
            label={t('owner.nav.barbers')}
            isLabelHidden
            size="sm"
            options={barberOptions}
            value={barberForView ?? ''}
            onChange={(v) => setBarberFilter(v || null)}
            width={200}
          />
        ) : null}
      </HStack>
      <Legend />

      {q.isPending ? (
        <VStack padding={4}>
          <ListSkeleton rows={6} height={64} />
        </VStack>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : view === 'week' ? (
        <WeekAgenda cal={q.data} from={from} onBooking={setOpenBooking} />
      ) : columns.length === 0 ? (
        <VStack padding={4}>
          <Text color="secondary">{t('barbers.empty')}</Text>
        </VStack>
      ) : (
        <Timeline
          cal={q.data}
          columns={columns}
          intl={intl}
          onBooking={setOpenBooking}
          onFree={(barberId, d, minute) => setNewBooking({ barberId, date: d, time: minToHHMM(minute) })}
          onBlock={setBlockId}
        />
      )}

      <BookingSheet booking={openBooking} onClose={() => setOpenBooking(null)} />
      <NewBookingSheet prefill={newBooking} onClose={() => setNewBooking(null)} />
      <BlockSheet open={blockOpen} onClose={() => setBlockOpen(false)} defaultDate={date} />
      <BlockDeleteDialog block={q.data?.blocks.find((b) => b.id === blockId) ?? null} onClose={() => setBlockId(null)} />
    </VStack>
  );
}

function Legend() {
  const { t } = useI18n();
  const items: { icon: typeof Check; key: MessageKey; cls: string }[] = [
    { icon: Check, key: 'cal.kind.confirmed', cls: 'bg-surface border-l-4 border-l-accent-bg' },
    { icon: X, key: 'cal.kind.cancelled', cls: 'border border-dashed border-border line-through' },
    { icon: UserX, key: 'cal.kind.no_show', cls: 'bg-surface' },
    { icon: Lock, key: 'cal.kind.block', cls: 'border-2 border-border-strong' },
    { icon: Coffee, key: 'cal.kind.break', cls: 'border border-border' },
    { icon: Plus, key: 'cal.kind.free', cls: 'border border-dashed border-border' },
    { icon: Ban, key: 'cal.kind.off', cls: 'border border-dashed border-border' },
  ];
  return (
    <details className="px-4 pb-2 text-xs text-secondary">
      <summary className="cursor-pointer select-none">{t('cal.legend')}</summary>
      <ul className="mt-2 flex flex-wrap gap-2">
        {items.map((i) => (
          <li key={i.key} className={`flex items-center gap-1 rounded-md px-2 py-1 ${i.cls}`}>
            <i.icon size={12} aria-hidden /> {t(i.key)}
          </li>
        ))}
      </ul>
    </details>
  );
}

function WeekAgenda({ cal, from, onBooking }: { cal: Calendar; from: string; onBooking: (b: CalBooking) => void }) {
  const { intl } = useTenant();
  const { t } = useI18n();
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const local = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: cal.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  return (
    <VStack gap={4} padding={4}>
      {days.map((d) => {
        const list = cal.bookings.filter((b) => local(b.starts_at) === d);
        const blocks = cal.blocks.filter((b) => local(b.starts_at) <= d && local(b.ends_at) >= d);
        const active = list.filter((b) => b.status !== 'cancelled').length;
        return (
          <VStack key={d} gap={1}>
            <HStack gap={2} vAlign="center" className="justify-between">
              <Heading level={2}>{fmtDateLong(d, intl)}</Heading>
              <Text type="supporting">{t('cal.bookingsCount', { n: active })}</Text>
            </HStack>
            {blocks.map((b) => (
              <HStack key={b.id} gap={1} vAlign="center" className="rounded-md border-2 border-border-strong px-2 py-1 text-sm">
                <Lock size={14} aria-hidden />
                <Text>
                  {t('cal.kind.block')}: {t(`block.kind.${b.kind}` as MessageKey)} · {cal.barbers.find((x) => x.id === b.barber_id)?.name ?? t('sched.shopWide')}
                </Text>
              </HStack>
            ))}
            {list.length === 0 ? (
              <Text type="supporting">{t('cal.empty')}</Text>
            ) : (
              <List hasDividers density="compact">
                {list.map((b) => (
                  <ListItem
                    key={b.id}
                    label={`${fmtTime(b.starts_at, cal.timezone, intl)} · ${b.customer_name}`}
                    description={`${b.service_name} · ${b.barber_name} · ${t(`cal.kind.${b.status}` as MessageKey)}`}
                    startContent={
                      <span className="flex size-7 items-center justify-center rounded-full text-xs font-bold text-body" style={{ backgroundColor: cal.barbers.find((x) => x.id === b.barber_id)?.color }} aria-hidden>
                        {b.status === 'cancelled' ? <X size={14} /> : b.status === 'no_show' ? <UserX size={14} /> : <Check size={14} />}
                      </span>
                    }
                    onClick={() => onBooking(b)}
                  />
                ))}
              </List>
            )}
          </VStack>
        );
      })}
    </VStack>
  );
}

