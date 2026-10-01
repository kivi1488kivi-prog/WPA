import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { DateInput } from '@astryxdesign/core/DateInput';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { List, ListItem } from '@astryxdesign/core/List';
import { Section } from '@astryxdesign/core/Section';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { TimeInput } from '@astryxdesign/core/TimeInput';
import { useToast } from '@astryxdesign/core/Toast';
import { VStack } from '@astryxdesign/core/VStack';
import { CalendarOff, Lock, Plus, Trash2 } from 'lucide-react';
import { useTenant } from '@/app/tenant';
import { useI18n, type MessageKey } from '@/lib/i18n';
import { fmtDateLong, fmtDateTime, hhmmToMin, minToHHMM } from '@/lib/time';
import { Sheet } from '@/components/Sheet';
import { Empty, errorText } from '@/components/States';
import { can, useOwner } from '../context';
import { BlockDeleteDialog, BlockSheet } from '../calendar/BlockSheet';
import { PageHeader, asDate, asTime } from '../ui';

export function SchedulePage() {
  const { tz, intl } = useTenant();
  const { t } = useI18n();
  const { api, workspace, role, myBarberId, tenantId, refreshWorkspace } = useOwner();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [blockOpen, setBlockOpen] = useState(false);
  const [blockDel, setBlockDel] = useState<string | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const barberName = (id: string | null) => (id ? (workspace.barbers.find((b) => b.id === id)?.name ?? '—') : t('sched.shopWide'));

  // group overrides by (barber, date)
  const groups = new Map<string, typeof workspace.overrides>();
  for (const o of workspace.overrides.filter((x) => x.on_date >= workspace.today)) {
    const k = `${o.on_date}|${o.barber_id ?? ''}`;
    groups.set(k, [...(groups.get(k) ?? []), o]);
  }
  const del = useMutation({
    mutationFn: ({ barberId, date }: { barberId: string | null; date: string }) => api.deleteOverride(barberId, date),
    onSuccess: async () => {
      await refreshWorkspace();
      void queryClient.invalidateQueries({ queryKey: ['owner', tenantId] });
    },
    onError: (e) => showToast({ body: errorText(t, e), type: 'error' }),
  });
  const blocks = workspace.blocks.filter((b) => b.ends_at > new Date().toISOString() && (role !== 'barber' || b.barber_id === null || b.barber_id === myBarberId));

  return (
    <VStack gap={0}>
      <PageHeader
        title={t('owner.nav.schedule')}
        actions={
          <>
            {can(role, 'manage') ? <Button label={t('sched.addOverride')} icon={<Icon icon={Plus} />} onClick={() => setOverrideOpen(true)} /> : null}
            <Button label={t('cal.newBlock')} icon={<Icon icon={Lock} />} variant="primary" onClick={() => setBlockOpen(true)} />
          </>
        }
      />
      <Section padding={4} paddingBlockStart={0}>
        <VStack gap={2}>
          <Heading level={2}>{t('sched.blocks')}</Heading>
          {blocks.length === 0 ? (
            <Empty title={t('sched.emptyBlocks')} icon={<Icon icon={Lock} />} />
          ) : (
            <List hasDividers>
              {blocks.map((b) => (
                <ListItem
                  key={b.id}
                  label={`${t(`block.kind.${b.kind}` as MessageKey)} · ${barberName(b.barber_id)}`}
                  description={`${fmtDateTime(b.starts_at, tz, intl)} – ${fmtDateTime(b.ends_at, tz, intl)}${b.note ? ` · ${b.note}` : ''}`}
                  startContent={<Icon icon={Lock} />}
                  endContent={<IconButton label={t('app.delete')} icon={<Icon icon={Trash2} />} variant="ghost" size="sm" onClick={() => setBlockDel(b.id)} />}
                />
              ))}
            </List>
          )}
        </VStack>
      </Section>
      <Section padding={4}>
        <VStack gap={2}>
          <Heading level={2}>{t('sched.overrides')}</Heading>
          {groups.size === 0 ? (
            <Empty title={t('sched.emptyOverrides')} icon={<Icon icon={CalendarOff} />} />
          ) : (
            <List hasDividers>
              {[...groups.entries()].sort().map(([k, list]) => {
                const first = list[0]!;
                const closed = list.every((o) => o.start_min === null);
                return (
                  <ListItem
                    key={k}
                    label={`${fmtDateLong(first.on_date, intl)} · ${barberName(first.barber_id)}`}
                    description={[
                      closed ? t('sched.closed') : list.map((o) => `${minToHHMM(o.start_min ?? 0)}–${minToHHMM(o.end_min ?? 0)}`).join(', '),
                      first.note,
                      first.source === 'pipeline' ? t('photos.fromConfig') : null,
                    ].filter(Boolean).join(' · ')}
                    startContent={<Icon icon={CalendarOff} />}
                    endContent={
                      can(role, 'manage') ? (
                        <IconButton label={t('app.delete')} icon={<Icon icon={Trash2} />} variant="ghost" size="sm" onClick={() => del.mutate({ barberId: first.barber_id, date: first.on_date })} />
                      ) : undefined
                    }
                  />
                );
              })}
            </List>
          )}
        </VStack>
      </Section>
      <BlockSheet open={blockOpen} onClose={() => { setBlockOpen(false); void refreshWorkspace(); }} defaultDate={workspace.today} />
      <BlockDeleteDialog block={workspace.blocks.find((b) => b.id === blockDel) ?? null} onClose={() => { setBlockDel(null); void refreshWorkspace(); }} />
      <OverrideSheet open={overrideOpen} onClose={() => setOverrideOpen(false)} />
    </VStack>
  );
}

function OverrideSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { api, workspace, tenantId, refreshWorkspace } = useOwner();
  const queryClient = useQueryClient();
  const [date, setDate] = useState(workspace.today);
  const [barberId, setBarberId] = useState('');
  const [mode, setMode] = useState<'closed' | 'hours'>('closed');
  const [from, setFrom] = useState('10:00');
  const [to, setTo] = useState('14:00');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => {
      const a = hhmmToMin(from);
      const b = hhmmToMin(to);
      if (mode === 'hours' && (a === null || b === null || a >= b)) throw new Error('invalid_input');
      return api.setOverride(barberId || null, date, mode === 'closed' ? null : [{ start_min: a as number, end_min: b as number }], note);
    },
    onSuccess: async () => {
      await refreshWorkspace();
      void queryClient.invalidateQueries({ queryKey: ['owner', tenantId] });
      onClose();
    },
    onError: (e) => setError(errorText(t, e)),
  });
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t('sched.addOverride')}
      footer={<Button label={t('app.save')} variant="primary" size="lg" width="100%" isLoading={m.isPending} onClick={() => m.mutate()} />}
    >
      <VStack gap={3}>
        {error ? <Banner status="error" title={error} /> : null}
        <DateInput label={t('bk.date')} value={asDate(date)} onChange={(v) => v && setDate(v)} width="100%" weekStartsOn="mon" min={asDate(workspace.today)} />
        <Selector
          label={t('block.scope')}
          options={[{ value: '', label: t('block.wholeShop') }, ...workspace.barbers.filter((b) => b.is_active).map((b) => ({ value: b.id, label: b.name }))]}
          value={barberId}
          onChange={setBarberId}
          width="100%"
        />
        <SegmentedControl label={t('sched.overrides')} value={mode} onChange={(v) => setMode(v as 'closed' | 'hours')} layout="fill">
          <SegmentedControlItem value="closed" label={t('sched.closed')} />
          <SegmentedControlItem value="hours" label={t('sched.customHours')} />
        </SegmentedControl>
        {mode === 'hours' ? (
          <HStack gap={2}>
            <TimeInput label={t('block.from')} value={asTime(from)} onChange={(v) => v && setFrom(v)} hourFormat="24h" increment={15} width="100%" />
            <TimeInput label={t('block.to')} value={asTime(to)} onChange={(v) => v && setTo(v)} hourFormat="24h" increment={15} width="100%" />
          </HStack>
        ) : null}
        <Text type="supporting">{barberId ? '' : t('sched.shopWide')}</Text>
        <TextInput label={t('block.note')} value={note} onChange={setNote} width="100%" isOptional />
      </VStack>
    </Sheet>
  );
}
