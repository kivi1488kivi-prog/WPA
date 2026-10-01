import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Divider } from '@astryxdesign/core/Divider';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon } from '@astryxdesign/core/Icon';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Selector } from '@astryxdesign/core/Selector';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { DateInput } from '@astryxdesign/core/DateInput';
import { TimeInput } from '@astryxdesign/core/TimeInput';
import { useToast } from '@astryxdesign/core/Toast';
import { VStack } from '@astryxdesign/core/VStack';
import { CalendarClock, Check, Copy, Phone, UserX, Wallet, XCircle } from 'lucide-react';
import { useTenant } from '@/app/tenant';
import { useI18n, type MessageKey } from '@/lib/i18n';
import type { CalBooking } from '@/lib/api/owner';
import { fmtMoney, parseMoneyToCents } from '@/lib/money';
import { newKey } from '@/lib/idempotency';
import { dateInTz, fmtDateTime, fmtTime, hhmmToMin, minutesInTz, minToHHMM, zonedToUtc } from '@/lib/time';
import { Sheet } from '@/components/Sheet';
import { errorText, ListSkeleton } from '@/components/States';
import { can, useOwner } from '../context';
import { asDate, asTime } from '../ui';

const DOT = { confirmed: 'success', cancelled: 'error', completed: 'neutral', no_show: 'warning' } as const;

export function BookingSheet({ booking, onClose }: { booking: CalBooking | null; onClose: () => void }) {
  const { slug, tz, intl } = useTenant();
  const { t } = useI18n();
  const { api, role, tenantId } = useOwner();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'view' | 'reschedule' | 'payment'>('view');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const details = useQuery({
    queryKey: ['owner', tenantId, 'booking', booking?.id],
    queryFn: () => api.bookingDetails(booking!.id),
    enabled: !!booking,
  });
  useEffect(() => {
    setMode('view');
    setConfirmCancel(false);
    setError(null);
    setNote(booking?.internal_note ?? '');
  }, [booking?.id, booking?.internal_note]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['owner', tenantId] });
  };
  const act = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      refresh();
      setError(null);
      showToast({ body: t('app.saved') });
    },
    onError: (e) => setError(errorText(t, e)),
  });

  if (!booking) return null;
  const b = booking;
  const past = new Date(b.starts_at) < new Date();
  const payments = details.data?.payments ?? [];
  const paid = payments.reduce((a, p) => a + (p.kind === 'payment' ? p.amount_cents : -p.amount_cents), 0);

  return (
    <Sheet
      open={!!booking}
      onOpenChange={(o) => !o && onClose()}
      title={`${fmtTime(b.starts_at, tz, intl)} · ${b.customer_name}`}
      description={`${fmtDateTime(b.starts_at, tz, intl)} · ${b.service_name} · ${b.barber_name}`}
      testId="owner-booking-sheet"
    >
      <VStack gap={4}>
        {error ? <Banner status="error" title={error} /> : null}
        <HStack gap={2} vAlign="center">
          <StatusDot variant={DOT[b.status]} label={t(`cal.kind.${b.status}` as MessageKey)} />
          <Text weight="semibold" data-testid="owner-booking-status">{t(`cal.kind.${b.status}` as MessageKey)}</Text>
          {b.is_demo ? <Text type="supporting">· {t('cal.demo')}</Text> : null}
        </HStack>
        <MetadataList>
          <MetadataListItem label={t('bk.client')}>
            <VStack gap={0.5}>
              <button type="button" className="text-start text-accent underline-offset-2 hover:underline" onClick={() => navigate(`/s/${slug}/owner/clients/${b.customer_id}`)}>
                {b.customer_name}
              </button>
              <a className="text-accent" href={`tel:${b.customer_phone.replace(/\s/g, '')}`}>
                <Phone size={12} aria-hidden className="me-1 inline" />
                {b.customer_phone}
              </a>
            </VStack>
          </MetadataListItem>
          <MetadataListItem label={t('booking.service')}>
            {b.service_name} · {t('app.minutes', { n: b.duration_min })}
          </MetadataListItem>
          <MetadataListItem label={t('booking.price')}>{fmtMoney(b.price_cents, b.currency, intl)}</MetadataListItem>
          {can(role, 'payments') ? (
            <MetadataListItem label={t('bk.paid')}>
              <Text data-testid="owner-paid">{fmtMoney(details.data ? paid : b.paid_cents, b.currency, intl)}</Text>
            </MetadataListItem>
          ) : null}
          {b.cancel_reason ? <MetadataListItem label={t('bk.cancelReason')}>{b.cancel_reason}</MetadataListItem> : null}
        </MetadataList>

        {b.status === 'confirmed' && mode === 'view' && !confirmCancel ? (
          <HStack gap={2} wrap="wrap">
            <Button label={t('booking.reschedule')} icon={<Icon icon={CalendarClock} />} onClick={() => setMode('reschedule')} data-testid="owner-reschedule" />
            {past ? (
              <>
                <Button label={t('bk.markCompleted')} icon={<Icon icon={Check} />} variant="primary" isLoading={act.isPending} onClick={() => act.mutate(() => api.setStatus(b.id, 'completed'))} />
                <Button label={t('bk.markNoShow')} icon={<Icon icon={UserX} />} onClick={() => act.mutate(() => api.setStatus(b.id, 'no_show'))} />
              </>
            ) : null}
            <Button label={t('booking.cancel')} icon={<Icon icon={XCircle} />} variant="destructive" onClick={() => setConfirmCancel(true)} data-testid="owner-cancel" />
          </HStack>
        ) : null}
        {(b.status === 'completed' || b.status === 'no_show') && role !== 'barber' && mode === 'view' ? (
          <Button label={t('bk.reopen')} onClick={() => act.mutate(() => api.setStatus(b.id, 'confirmed'))} />
        ) : null}
        {can(role, 'payments') && b.status !== 'cancelled' && mode === 'view' ? (
          <Button label={t('bk.payment')} icon={<Icon icon={Wallet} />} onClick={() => setMode('payment')} data-testid="owner-payment" />
        ) : null}

        {mode === 'reschedule' ? <OwnerReschedule booking={b} onDone={() => { setMode('view'); refresh(); onClose(); }} onCancel={() => setMode('view')} /> : null}
        {confirmCancel ? (
          <VStack gap={3} className="rounded-lg border border-error p-3">
            <Text weight="semibold">{t('booking.cancelConfirmTitle')}</Text>
            <TextInput label={t('bk.cancelReason')} value={reason} onChange={setReason} width="100%" isOptional />
            <HStack gap={2}>
              <Button
                label={t('booking.cancel')}
                variant="destructive"
                isLoading={act.isPending}
                data-testid="owner-confirm-cancel"
                onClick={() =>
                  act.mutate(() => api.cancel(b.id, reason.trim() || null), {
                    onSettled: () => setConfirmCancel(false),
                    onSuccess: () => onClose(),
                  })
                }
              />
              <Button label={t('app.back')} variant="ghost" onClick={() => setConfirmCancel(false)} />
            </HStack>
          </VStack>
        ) : null}
        {mode === 'payment' ? <PaymentForm booking={b} paid={paid} onDone={() => { setMode('view'); refresh(); }} onCancel={() => setMode('view')} /> : null}

        <Divider />
        <TextArea label={t('bk.note')} value={note} onChange={setNote} rows={2} width="100%" />
        <HStack gap={2} wrap="wrap">
          <Button label={t('app.save')} size="sm" isDisabled={note === b.internal_note} onClick={() => act.mutate(() => api.setNote(b.id, note))} />
          <Button
            label={t('bk.clientLink')}
            size="sm"
            icon={<Icon icon={Copy} />}
            onClick={async () => {
              const token = await api.accessToken(b.id).catch(() => null);
              if (!token) return;
              const link = `${window.location.origin}/s/${slug}/booking#${token}`;
              await navigator.clipboard.writeText(link).then(
                () => showToast({ body: t('booking.linkCopied') }),
                () => showToast({ body: link }),
              );
            }}
          />
        </HStack>

        <Collapsible trigger={<Text weight="semibold">{t('bk.history')}</Text>} defaultIsOpen={false}>
          {details.isPending ? (
            <ListSkeleton rows={2} height={20} />
          ) : (
            <VStack gap={1}>
              {(details.data?.events ?? []).map((e, i) => (
                <Text key={i} type="supporting">
                  {fmtDateTime(e.at, tz, intl)} · {e.type} · {e.actor.startsWith('staff') ? t('owner.title') : e.actor}
                </Text>
              ))}
              {payments.map((p) => (
                <Text key={p.id} type="supporting">
                  {fmtDateTime(p.paid_at, tz, intl)} · {p.kind === 'refund' ? t('bk.refund') : t('bk.payment')} {fmtMoney(p.amount_cents, p.currency, intl)} ·{' '}
                  {t(`bk.method.${p.method}` as MessageKey)}
                </Text>
              ))}
              <Text weight="semibold">{t('bk.notifications')}</Text>
              {(details.data?.notifications ?? []).map((n, i) => (
                <Text key={i} type="supporting">
                  {n.audience}/{n.event}: {n.status}
                  {n.status_reason ? ` (${n.status_reason})` : ''}
                </Text>
              ))}
            </VStack>
          )}
        </Collapsible>
      </VStack>

    </Sheet>
  );
}

function OwnerReschedule({ booking, onDone, onCancel }: { booking: CalBooking; onDone: () => void; onCancel: () => void }) {
  const { tz } = useTenant();
  const { t } = useI18n();
  const { api, role, workspace } = useOwner();
  const [date, setDate] = useState(dateInTz(booking.starts_at, tz));
  const [time, setTime] = useState(minToHHMM(minutesInTz(booking.starts_at, tz)));
  const [barberId, setBarberId] = useState(booking.barber_id);
  const [ignoreHours, setIgnoreHours] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(newKey);
  const m = useMutation({
    mutationFn: () => {
      const minutes = hhmmToMin(time);
      if (minutes === null) throw new Error('invalid_input');
      return api.reschedule(booking.id, zonedToUtc(date, minutes, tz).toISOString(), barberId === booking.barber_id ? null : barberId, ignoreHours, key);
    },
    onSuccess: onDone,
    onError: (e) => setError(errorText(t, e)),
  });
  const barbers = workspace.barbers.filter((b) => b.is_active && b.service_ids.includes(booking.service_id) && (role !== 'barber' || b.id === booking.barber_id));
  return (
    <VStack gap={3} className="rounded-lg border border-border p-3">
      {error ? <Banner status="error" title={error} /> : null}
      <DateInput label={t('bk.date')} value={asDate(date)} onChange={(v) => v && setDate(v)} width="100%" weekStartsOn="mon" />
      <TimeInput label={t('bk.time')} value={asTime(time)} onChange={(v) => v && setTime(v)} hourFormat="24h" increment={5} width="100%" />
      {barbers.length > 1 ? (
        <Selector label={t('booking.with')} options={barbers.map((b) => ({ value: b.id, label: b.name }))} value={barberId} onChange={setBarberId} width="100%" />
      ) : null}
      {can(role, 'manage') ? <Switch label={t('bk.ignoreHours')} value={ignoreHours} onChange={setIgnoreHours} /> : null}
      <HStack gap={2}>
        <Button label={t('booking.confirmMove')} variant="primary" isLoading={m.isPending} onClick={() => m.mutate()} data-testid="owner-confirm-reschedule" />
        <Button label={t('app.cancel')} variant="ghost" onClick={onCancel} />
      </HStack>
    </VStack>
  );
}

function PaymentForm({ booking, paid, onDone, onCancel }: { booking: CalBooking; paid: number; onDone: () => void; onCancel: () => void }) {
  const { intl } = useTenant();
  const { t } = useI18n();
  const { api } = useOwner();
  const remaining = Math.max(booking.price_cents - paid, 0);
  const [kind, setKind] = useState<'payment' | 'refund'>(remaining > 0 || paid === 0 ? 'payment' : 'refund');
  const [amount, setAmount] = useState(((kind === 'payment' ? remaining || booking.price_cents : paid) / 100).toFixed(2));
  const [method, setMethod] = useState('card');
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(newKey);
  const m = useMutation({
    mutationFn: () => {
      const cents = parseMoneyToCents(amount);
      if (!cents) throw new Error('invalid_input');
      return api.recordPayment(booking.id, cents, method, kind, '', key);
    },
    onSuccess: onDone,
    onError: (e) => setError(errorText(t, e)),
  });
  return (
    <VStack gap={3} className="rounded-lg border border-border p-3">
      {error ? <Banner status="error" title={error} /> : null}
      <Selector
        label={t('bk.payment')}
        options={[
          { value: 'payment', label: t('bk.payment') },
          ...(paid > 0 ? [{ value: 'refund', label: t('bk.refund') }] : []),
        ]}
        value={kind}
        onChange={(v) => setKind(v as 'payment' | 'refund')}
        width="100%"
      />
      <TextInput label={`${t('bk.amount')} (${booking.currency})`} value={amount} onChange={setAmount} width="100%" description={fmtMoney(booking.price_cents, booking.currency, intl)} />
      <Selector
        label={t('bk.method')}
        options={(['cash', 'card', 'transfer', 'online', 'other'] as const).map((v) => ({ value: v, label: t(`bk.method.${v}`) }))}
        value={method}
        onChange={setMethod}
        width="100%"
      />
      <HStack gap={2}>
        <Button label={t('app.save')} variant="primary" isLoading={m.isPending} onClick={() => m.mutate()} data-testid="owner-save-payment" />
        <Button label={t('app.cancel')} variant="ghost" onClick={onCancel} />
      </HStack>
    </VStack>
  );
}
