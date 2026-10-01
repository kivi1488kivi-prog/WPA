import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon } from '@astryxdesign/core/Icon';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Section } from '@astryxdesign/core/Section';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { useToast } from '@astryxdesign/core/Toast';
import { VStack } from '@astryxdesign/core/VStack';
import { Bell, CalendarClock, CalendarPlus, CircleCheck, CircleX, Copy, SearchX, XCircle } from 'lucide-react';
import { useTenant } from '@/app/tenant';
import { useI18n, type MessageKey } from '@/lib/i18n';
import { publicApi } from '@/lib/api/public';
import { getSupabase } from '@/lib/supabase';
import { toApiError } from '@/lib/api/errors';
import { attemptKey, clearAttemptKey } from '@/lib/idempotency';
import { saveToken } from '@/lib/tokenStore';
import { buildIcs, downloadIcs } from '@/lib/ics';
import { mediaUrl } from '@/lib/media';
import { fmtMoney } from '@/lib/money';
import { pushSupport, subscribePush } from '@/lib/push';
import { deviceTimezone, fmtDateLong, fmtDateTime, fmtTime } from '@/lib/time';
import { Sheet } from '@/components/Sheet';
import { Empty, ErrorState, ListSkeleton, errorText } from '@/components/States';
import { TimePicker } from '@/features/booking/TimePicker';
import type { PublicBooking } from '@/lib/api/schemas';

function readToken(hash: string): string | null {
  const raw = decodeURIComponent(hash.replace(/^#/, '')).trim();
  return /^[A-Za-z0-9_-]{32,128}$/.test(raw) ? raw : null;
}

const STATUS_ICON = { confirmed: CircleCheck, cancelled: CircleX, completed: CircleCheck, no_show: XCircle } as const;
const STATUS_DOT = { confirmed: 'success', cancelled: 'error', completed: 'neutral', no_show: 'warning' } as const;

export function MyBookingPage() {
  const { slug, shop, tz, intl } = useTenant();
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const token = useMemo(() => readToken(location.hash), [location.hash]);
  const justBooked = (location.state as { justBooked?: boolean } | null)?.justBooked === true;
  const headingRef = useRef<HTMLHeadingElement>(null);

  const q = useQuery({
    queryKey: ['booking', slug, token],
    queryFn: () => publicApi.booking(slug, token as string),
    enabled: token !== null,
  });

  useEffect(() => {
    if (token && q.data) saveToken(slug, token, q.data.starts_at);
  }, [token, q.data, slug]);

  // Move focus to the confirmation heading for screen-reader users.
  useEffect(() => {
    if (q.data) headingRef.current?.focus();
  }, [q.data?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [confirmCancel, setConfirmCancel] = useState(false);
  const [reschedOpen, setReschedOpen] = useState(false);

  const setBooking = (b: PublicBooking) => queryClient.setQueryData(['booking', slug, token], b);

  const cancel = useMutation({
    mutationFn: () => publicApi.cancel(slug, token as string, null),
    onSuccess: (b) => {
      setBooking(b);
      setConfirmCancel(false);
      void queryClient.invalidateQueries({ queryKey: ['slots', slug] });
      showToast({ body: t('booking.cancelled') });
    },
    onError: (err) => {
      setConfirmCancel(false);
      showToast({ body: errorText(t, err), type: 'error' });
      void q.refetch();
    },
  });

  if (!token) {
    return (
      <Section padding={4}>
        <Empty title={t('booking.notFound')} description={t('booking.notFoundHint')} icon={<Icon icon={SearchX} />} />
      </Section>
    );
  }
  if (q.isPending) {
    return (
      <Section padding={4}>
        <ListSkeleton rows={5} />
      </Section>
    );
  }
  if (q.isError) {
    if (toApiError(q.error).code === 'booking_not_found') {
      return (
        <Section padding={4}>
          <Empty title={t('booking.notFound')} description={t('booking.notFoundHint')} icon={<Icon icon={SearchX} />} />
        </Section>
      );
    }
    return (
      <Section padding={4}>
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </Section>
    );
  }

  const b = q.data;
  const isActive = b.status === 'confirmed' && new Date(b.ends_at) > new Date();
  const otherTz = deviceTimezone() !== b.timezone;
  const reasonText = (r: string | null) => (r ? t(`booking.reason.${r}` as MessageKey) : '');
  const link = `${window.location.origin}/s/${slug}/booking#${token}`;

  const addToCalendar = () => {
    const ics = buildIcs({
      uid: b.id,
      version: b.version,
      startsAt: b.starts_at,
      endsAt: b.ends_at,
      title: `${b.service.name} — ${b.tenant.name}`,
      description: `${t('booking.with')}: ${b.barber.name}\n${link}`,
      location: [b.tenant.address_line, b.tenant.city].filter(Boolean).join(', '),
      url: link,
    });
    downloadIcs(`booking-${b.local_date}.ics`, ics);
    showToast({ body: t('booking.icsDone') });
  };

  return (
    <VStack gap={0}>
      <Section padding={4}>
        <VStack gap={3}>
          {b.is_demo ? <Banner status="warning" title={t('booking.demo')} /> : null}
          <HStack gap={2} vAlign="center">
            <Icon icon={STATUS_ICON[b.status]} color={b.status === 'confirmed' ? 'success' : b.status === 'cancelled' ? 'error' : 'secondary'} />
            <Heading level={1} id="booking-h">
              <span ref={headingRef} tabIndex={-1} className="outline-none">
                {justBooked && b.status === 'confirmed' ? t('booking.confirmed') : `${b.service.name}`}
              </span>
            </Heading>
          </HStack>
          <HStack gap={2} vAlign="center">
            <StatusDot variant={STATUS_DOT[b.status]} label={t(`booking.status.${b.status}` as MessageKey)} />
            <Text weight="semibold" data-testid="booking-status">{t(`booking.status.${b.status}` as MessageKey)}</Text>
          </HStack>
          <MetadataList>
            <MetadataListItem label={t('booking.when')}>
              <VStack gap={0.5}>
                <Text weight="semibold" data-testid="booking-when">
                  {fmtDateLong(b.local_date, intl)}, {b.local_time}
                </Text>
                {otherTz ? <Text type="supporting">{t('app.tzNote', { tz: b.timezone })}</Text> : null}
              </VStack>
            </MetadataListItem>
            <MetadataListItem label={t('booking.service')}>
              {b.service.name} · {t('app.minutes', { n: b.service.duration_min })}
            </MetadataListItem>
            <MetadataListItem label={t('booking.with')}>
              <HStack gap={2} vAlign="center">
                <Avatar src={mediaUrl(b.barber.photo_path) ?? undefined} name={b.barber.name} size="sm" tooltip={false} />
                <Text data-testid="booking-barber">{b.barber.name}</Text>
              </HStack>
            </MetadataListItem>
            <MetadataListItem label={t('booking.price')}>{fmtMoney(b.service.price_cents, b.service.currency, intl)}</MetadataListItem>
            <MetadataListItem label={t('booking.where')}>
              {[b.tenant.name, b.tenant.address_line, b.tenant.city].filter(Boolean).join(', ')}
            </MetadataListItem>
            <MetadataListItem label={t('booking.name')}>
              {b.customer.name} · {b.customer.phone_masked}
            </MetadataListItem>
          </MetadataList>
        </VStack>
      </Section>

      {isActive ? (
        <Section padding={4}>
          <VStack gap={3}>
            <Text type="supporting">{t('booking.keepLink')}</Text>
            <HStack gap={2} wrap="wrap">
              <Button
                label={t('booking.copyLink')}
                icon={<Icon icon={Copy} />}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(link);
                    showToast({ body: t('booking.linkCopied') });
                  } catch {
                    showToast({ body: link });
                  }
                }}
              />
              <Button label={t('booking.addToCalendar')} icon={<Icon icon={CalendarPlus} />} onClick={addToCalendar} />
            </HStack>
            <Text type="supporting">{t('booking.icsNote')}</Text>
            <PushToggle token={token} />
          </VStack>
        </Section>
      ) : null}

      {b.status === 'confirmed' ? (
        <Section padding={4}>
          <VStack gap={3}>
            <Button
              label={t('booking.reschedule')}
              icon={<Icon icon={CalendarClock} />}
              variant="primary"
              size="lg"
              width="100%"
              isDisabled={!b.actions.can_reschedule}
              onClick={() => setReschedOpen(true)}
              data-testid="reschedule-btn"
            />
            {!b.actions.can_reschedule ? (
              <Text type="supporting">{t('booking.cannotReschedule', { reason: reasonText(b.actions.reschedule_block_reason) })}</Text>
            ) : (
              <Text type="supporting">{t('booking.deadline', { date: fmtDateTime(b.actions.reschedule_deadline, tz, intl) })}</Text>
            )}
            <Button
              label={t('booking.cancel')}
              variant="destructive"
              size="lg"
              width="100%"
              isDisabled={!b.actions.can_cancel}
              onClick={() => setConfirmCancel(true)}
              data-testid="cancel-btn"
            />
            {!b.actions.can_cancel ? (
              <Text type="supporting">
                {t('booking.cannotCancel', { reason: reasonText(b.actions.cancel_block_reason) })}
                {shop.tenant.phone ? ` · ${shop.tenant.phone}` : ''}
              </Text>
            ) : (
              <Text type="supporting">{t('booking.deadline', { date: fmtDateTime(b.actions.cancel_deadline, tz, intl) })}</Text>
            )}
          </VStack>
        </Section>
      ) : (
        <Section padding={4}>
          <Button label={t('shop.bookCta')} variant="primary" size="lg" width="100%" onClick={() => navigate(`/s/${slug}/book`)} />
        </Section>
      )}

      <AlertDialog
        isOpen={confirmCancel}
        onOpenChange={setConfirmCancel}
        title={t('booking.cancelConfirmTitle')}
        description={t('booking.cancelConfirmBody')}
        actionLabel={t('booking.cancel')}
        cancelLabel={t('app.back')}
        onAction={() => cancel.mutate()}
        isActionLoading={cancel.isPending}
      />
      <RescheduleSheet
        open={reschedOpen}
        onOpenChange={setReschedOpen}
        booking={b}
        token={token}
        onDone={(nb) => {
          setBooking(nb);
          setReschedOpen(false);
          showToast({ body: t('booking.rescheduled', { date: fmtDateLong(nb.local_date, intl), time: nb.local_time }) });
        }}
      />
    </VStack>
  );
}

function RescheduleSheet({
  open,
  onOpenChange,
  booking,
  token,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  booking: PublicBooking;
  token: string;
  onDone: (b: PublicBooking) => void;
}) {
  const { slug, shop, tz, intl } = useTenant();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [keepBarber, setKeepBarber] = useState(true);
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const barberStillActive = shop.barbers.some((x) => x.id === booking.barber.id);
  const sameBarber = keepBarber && barberStillActive;
  const scope = `resched:${booking.id}:${booking.version}:${slot}:${sameBarber}`;

  const m = useMutation({
    mutationFn: () =>
      publicApi.reschedule(slug, token, {
        startsAt: slot as string,
        barberId: sameBarber ? booking.barber.id : null,
        anyBarber: !sameBarber,
        idempotencyKey: attemptKey(scope),
      }),
    onSuccess: (nb) => {
      clearAttemptKey(scope);
      setSlot(null);
      void queryClient.invalidateQueries({ queryKey: ['slots', slug] });
      void queryClient.invalidateQueries({ queryKey: ['dates', slug] });
      onDone(nb);
    },
    onError: (err) => {
      clearAttemptKey(scope);
      if (toApiError(err).code === 'slot_unavailable') {
        setSlot(null);
        void queryClient.invalidateQueries({ queryKey: ['slots', slug] });
        setError(t('book.slotTaken'));
      } else setError(errorText(t, err));
    },
  });

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !m.isPending && onOpenChange(o)}
      title={t('booking.pickNewTime')}
      description={`${booking.service.name} · ${fmtDateLong(booking.local_date, intl)}, ${booking.local_time}`}
      testId="sheet-reschedule"
      footer={
        <Button
          label={slot ? `${t('booking.confirmMove')} · ${fmtTime(slot, tz, intl)}` : t('booking.confirmMove')}
          variant="primary"
          size="lg"
          width="100%"
          isDisabled={!slot}
          isLoading={m.isPending}
          onClick={() => {
            setError(null);
            m.mutate();
          }}
          data-testid="confirm-reschedule"
        />
      }
    >
      <VStack gap={4}>
        {error ? <Banner status="warning" title={error} /> : null}
        {barberStillActive ? (
          <Switch
            label={`${t('booking.keepBarber')}: ${booking.barber.name}`}
            value={keepBarber}
            onChange={(v) => {
              setKeepBarber(v);
              setSlot(null);
            }}
          />
        ) : (
          <HStack gap={2} vAlign="center">
            <Icon icon={Bell} size="sm" />
            <Text type="supporting">{t('book.anyBarberHint')}</Text>
          </HStack>
        )}
        <TimePicker
          serviceId={booking.service.id}
          barberId={sameBarber ? booking.barber.id : null}
          date={date}
          selected={slot}
          onDateChange={(d) => {
            setDate(d);
            setSlot(null);
          }}
          onSelect={(s) => setSlot(s)}
        />
      </VStack>
    </Sheet>
  );
}

/** Honest push state: supported / denied / iOS needs install / not configured. */
function PushToggle({ token }: { token: string }) {
  const { slug } = useTenant();
  const { t } = useI18n();
  const support = pushSupport();
  const [state, setState] = useState<'idle' | 'on' | 'error' | 'denied'>(() =>
    typeof Notification !== 'undefined' && Notification.permission === 'denied' ? 'denied' : 'idle',
  );
  const enable = useMutation({
    mutationFn: async () => {
      const sub = await subscribePush(slug, 'client');
      const res = await getSupabase(slug).rpc('register_customer_push', {
        p_token: token,
        p_subscription: sub,
        p_user_agent: navigator.userAgent,
        p_slug: slug,
      });
      if (res.error) throw res.error;
    },
    onSuccess: () => setState('on'),
    onError: (e) => setState(e instanceof Error && e.message === 'denied' ? 'denied' : 'error'),
  });

  if (support === 'not-configured') return <Text type="supporting">{t('push.notConfigured')}</Text>;
  if (support === 'ios-needs-install') return <Banner status="info" title={t('push.iosInstall')} />;
  if (support === 'unsupported') return <Text type="supporting">{t('push.unsupported')}</Text>;
  if (state === 'denied') return <Text type="supporting">{t('push.denied')}</Text>;
  if (state === 'on')
    return (
      <HStack gap={2} vAlign="center">
        <Icon icon={Bell} color="success" />
        <Text>{t('push.enabled')}</Text>
      </HStack>
    );
  return (
    <VStack gap={1}>
      <Button label={t('push.enable')} icon={<Icon icon={Bell} />} isLoading={enable.isPending} onClick={() => enable.mutate()} />
      {state === 'error' ? <Text type="supporting">{t('push.failed')}</Text> : null}
    </VStack>
  );
}

