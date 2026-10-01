import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { DateInput } from '@astryxdesign/core/DateInput';
import { HStack } from '@astryxdesign/core/HStack';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { TimeInput } from '@astryxdesign/core/TimeInput';
import { useToast } from '@astryxdesign/core/Toast';
import { VStack } from '@astryxdesign/core/VStack';
import { useTenant } from '@/app/tenant';
import { useI18n, type MessageKey } from '@/lib/i18n';
import { toApiError } from '@/lib/api/errors';
import { fmtDateTime, hhmmToMin, zonedToUtc } from '@/lib/time';
import { Sheet } from '@/components/Sheet';
import { errorText } from '@/components/States';
import { can, useOwner } from '../context';
import { asDate, asTime } from '../ui';

export const BLOCK_KINDS = ['vacation', 'break', 'sanitary', 'event', 'day_off', 'other'] as const;

interface Conflict { booking_id: string; barber_name: string; starts_at: string; customer_name: string; service_name: string }

/** Block time for one barber or the whole shop (vacation, sanitary day, event…). */
export function BlockSheet({ open, onClose, defaultDate }: { open: boolean; onClose: () => void; defaultDate: string }) {
  const { tz, intl } = useTenant();
  const { t } = useI18n();
  const { api, role, myBarberId, workspace, tenantId } = useOwner();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [barberId, setBarberId] = useState<string>(role === 'barber' ? (myBarberId ?? '') : '');
  const [fromDate, setFromDate] = useState(defaultDate);
  const [fromTime, setFromTime] = useState('00:00');
  const [toDate, setToDate] = useState(defaultDate);
  const [toTime, setToTime] = useState('23:59');
  const [kind, setKind] = useState<string>('day_off');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);

  useEffect(() => {
    if (!open) return;
    setFromDate(defaultDate);
    setToDate(defaultDate);
    setError(null);
    setConflicts([]);
  }, [open, defaultDate]);

  const m = useMutation({
    mutationFn: () => {
      const a = hhmmToMin(fromTime);
      const b = hhmmToMin(toTime);
      if (a === null || b === null) throw new Error('invalid_input');
      // "23:59" end means end of that day.
      const end = b === 23 * 60 + 59 ? zonedToUtc(toDate, 1440, tz) : zonedToUtc(toDate, b, tz);
      return api.createBlock(barberId || null, zonedToUtc(fromDate, a, tz).toISOString(), end.toISOString(), kind, note);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['owner', tenantId] });
      showToast({ body: t('block.created') });
      onClose();
    },
    onError: (e) => {
      const err = toApiError(e);
      if (err.code === 'block_conflict') {
        try {
          setConflicts(JSON.parse(err.detail) as Conflict[]);
        } catch {
          setConflicts([]);
        }
      }
      setError(errorText(t, e));
    },
  });

  const barberOptions = [
    ...(can(role, 'manage') ? [{ value: '', label: t('block.wholeShop') }] : []),
    ...workspace.barbers.filter((b) => b.is_active && (role !== 'barber' || b.id === myBarberId)).map((b) => ({ value: b.id, label: b.name })),
  ];

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t('block.title')}
      testId="owner-block-sheet"
      footer={<Button label={t('app.save')} variant="primary" size="lg" width="100%" isLoading={m.isPending} onClick={() => m.mutate()} />}
    >
      <VStack gap={3}>
        {error ? <Banner status="error" title={error} /> : null}
        {conflicts.length > 0 ? (
          <VStack gap={1}>
            <Text weight="semibold">{t('block.conflicts')}</Text>
            {conflicts.map((c) => (
              <Text key={c.booking_id} type="supporting">
                {fmtDateTime(c.starts_at, tz, intl)} · {c.barber_name} · {c.customer_name} · {c.service_name}
              </Text>
            ))}
          </VStack>
        ) : null}
        <Selector label={t('block.scope')} options={barberOptions} value={barberId} onChange={setBarberId} width="100%" />
        <Selector label={t('block.kind')} options={BLOCK_KINDS.map((k) => ({ value: k, label: t(`block.kind.${k}` as MessageKey) }))} value={kind} onChange={setKind} width="100%" />
        <HStack gap={2}>
          <DateInput label={t('block.from')} value={asDate(fromDate)} onChange={(v) => v && (setFromDate(v), v > toDate && setToDate(v))} width="100%" weekStartsOn="mon" />
          <TimeInput label=" " value={asTime(fromTime)} onChange={(v) => v && setFromTime(v)} hourFormat="24h" increment={15} width={120} />
        </HStack>
        <HStack gap={2}>
          <DateInput label={t('block.to')} value={asDate(toDate)} onChange={(v) => v && setToDate(v)} width="100%" weekStartsOn="mon" min={asDate(fromDate)} />
          <TimeInput label=" " value={asTime(toTime)} onChange={(v) => v && setToTime(v)} hourFormat="24h" increment={15} width={120} />
        </HStack>
        <TextInput label={t('block.note')} value={note} onChange={setNote} width="100%" isOptional />
      </VStack>
    </Sheet>
  );
}

export function BlockDeleteDialog({ block, onClose }: { block: { id: string; kind: string; starts_at: string; ends_at: string; note: string } | null; onClose: () => void }) {
  const { tz, intl } = useTenant();
  const { t } = useI18n();
  const { api, tenantId } = useOwner();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const m = useMutation({
    mutationFn: () => api.deleteBlock(block!.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['owner', tenantId] });
      onClose();
    },
    onError: (e) => showToast({ body: errorText(t, e), type: 'error' }),
  });
  return (
    <AlertDialog
      isOpen={!!block}
      onOpenChange={(o) => !o && onClose()}
      title={`${t('app.delete')}: ${block ? t(`block.kind.${block.kind}` as MessageKey) : ''}`}
      description={block ? `${fmtDateTime(block.starts_at, tz, intl)} – ${fmtDateTime(block.ends_at, tz, intl)}${block.note ? ` · ${block.note}` : ''}` : ''}
      actionLabel={t('app.delete')}
      cancelLabel={t('app.back')}
      isActionLoading={m.isPending}
      onAction={() => m.mutate()}
    />
  );
}
