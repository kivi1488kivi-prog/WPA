import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon } from '@astryxdesign/core/Icon';
import { List, ListItem } from '@astryxdesign/core/List';
import { Section } from '@astryxdesign/core/Section';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import { Check, Users } from 'lucide-react';
import { useTenant } from '@/app/tenant';
import { useI18n } from '@/lib/i18n';
import { publicApi } from '@/lib/api/public';
import { toApiError } from '@/lib/api/errors';
import { attemptKey, clearAttemptKey } from '@/lib/idempotency';
import { saveToken } from '@/lib/tokenStore';
import { mediaUrl } from '@/lib/media';
import { fmtMoney } from '@/lib/money';
import { fmtDateLong, fmtHoursFromMinutes, fmtTime } from '@/lib/time';
import { Sheet } from '@/components/Sheet';
import { PhoneField } from '@/components/PhoneField';
import { errorText } from '@/components/States';
import { TimePicker } from './TimePicker';

type Step = 'service' | 'barber' | 'time' | 'details';

const PROFILE_KEY = (slug: string) => `bk-profile:${slug}`;
function loadProfile(slug: string): { name: string; phone: string; email: string } {
  try {
    const v = JSON.parse(localStorage.getItem(PROFILE_KEY(slug)) ?? 'null') as { name?: string; phone?: string; email?: string } | null;
    return { name: v?.name ?? '', phone: v?.phone ?? '', email: v?.email ?? '' };
  } catch {
    return { name: '', phone: '', email: '' };
  }
}

/**
 * Booking flow as sequential bottom sheets driven by URL search params, so
 * the hardware/browser Back button steps back through the flow and every
 * step is a shareable deep link (e.g. /s/{slug}/book?service=…&barber=any).
 */
export function BookingPage() {
  const { slug, shop, tz, intl } = useTenant();
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const queryClient = useQueryClient();

  const serviceId = params.get('service');
  const barberParam = params.get('barber'); // uuid | 'any' | null
  const date = params.get('date');
  const slot = params.get('slot');

  const service = shop.services.find((s) => s.id === serviceId) ?? null;
  const eligibleBarbers = useMemo(
    () => (service ? shop.barbers.filter((b) => service.barber_ids.includes(b.id)) : shop.barbers),
    [service, shop.barbers],
  );
  const barber = barberParam && barberParam !== 'any' ? (shop.barbers.find((b) => b.id === barberParam) ?? null) : null;
  const barberChosen = barberParam === 'any' || (barber !== null && (!service || service.barber_ids.includes(barber.id)));

  const step: Step = !service ? 'service' : !barberChosen ? 'barber' : !slot ? 'time' : 'details';

  const go = useCallback(
    (patch: Record<string, string | null>, replace = false) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      navigate({ pathname: location.pathname, search: next.toString() }, { replace });
    },
    [navigate, params, location.pathname],
  );

  // Closing a sheet = one step back (history), or home if the flow was deep-linked.
  const close = () => {
    if (location.key !== 'default') navigate(-1);
    else navigate(`/s/${slug}/`, { replace: true });
  };

  // Barber preselected from the barber sheet but service missing: keep barber, filter services.
  const servicesForStep = barber && !service ? shop.services.filter((s) => s.barber_ids.includes(barber.id)) : shop.services;

  const [form, setForm] = useState(() => loadProfile(slug));
  const [fieldErr, setFieldErr] = useState<Partial<Record<'name' | 'phone' | 'email', string>>>({});
  const [flowError, setFlowError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLElement>(null);

  useEffect(() => setFlowError(null), [step]);

  const attemptScope = `${slug}:${serviceId}:${barberParam}:${slot}`;
  const create = useMutation({
    mutationFn: () =>
      publicApi.createBooking(slug, {
        serviceId: serviceId as string,
        barberId: barberParam === 'any' ? null : barberParam,
        startsAt: slot as string,
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        idempotencyKey: attemptKey(attemptScope),
      }),
    onSuccess: (res) => {
      clearAttemptKey(attemptScope);
      saveToken(slug, res.token, res.booking.starts_at);
      try {
        localStorage.setItem(PROFILE_KEY(slug), JSON.stringify({ name: form.name.trim(), phone: form.phone.trim(), email: form.email.trim() }));
      } catch {
        /* optional convenience */
      }
      void queryClient.invalidateQueries({ queryKey: ['slots', slug] });
      void queryClient.invalidateQueries({ queryKey: ['dates', slug] });
      queryClient.setQueryData(['booking', slug, res.token], res.booking);
      navigate(`/s/${slug}/booking#${res.token}`, { replace: true, state: { justBooked: true } });
    },
    onError: (err) => {
      const e = toApiError(err);
      if (e.code === 'invalid_name') setFieldErr({ name: t('err.invalid_name') });
      else if (e.code === 'invalid_phone') setFieldErr({ phone: t('err.invalid_phone') });
      else if (e.code === 'invalid_email') setFieldErr({ email: t('err.invalid_email') });
      else if (e.code === 'slot_unavailable') {
        // Another client won the race (or lead time passed): back to time choice.
        clearAttemptKey(attemptScope);
        void queryClient.invalidateQueries({ queryKey: ['slots', slug] });
        void queryClient.invalidateQueries({ queryKey: ['dates', slug] });
        go({ slot: null }, true);
        setTimeout(() => setFlowError(t('book.slotTaken')), 0);
      } else setFlowError(errorText(t, err));
    },
  });

  const submit = () => {
    const errs: typeof fieldErr = {};
    if (!form.name.trim()) errs.name = t('err.invalid_name');
    if (form.phone.replace(/\D/g, '').length < 7) errs.phone = t('err.invalid_phone');
    if (form.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) errs.email = t('err.invalid_email');
    setFieldErr(errs);
    if (Object.keys(errs).length > 0) {
      firstFieldRef.current?.querySelector<HTMLInputElement>('[aria-invalid="true"], input')?.focus();
      return;
    }
    create.mutate();
  };

  const rules = shop.tenant.rules;
  const summaryTime = slot ? `${fmtDateLong(date ?? slot.slice(0, 10), intl)}, ${fmtTime(slot, tz, intl)}` : null;

  return (
    <VStack gap={0}>
      <Section padding={4}>
        <VStack gap={3}>
          <Heading level={1}>{t('book.title')}</Heading>
          {flowError && step !== 'details' ? <Banner status="warning" title={flowError} /> : null}
          <List hasDividers>
            <ListItem
              label={t('book.summary.service')}
              description={service ? `${service.name} · ${t('app.minutes', { n: service.duration_min })} · ${fmtMoney(service.price_cents, shop.tenant.currency, intl)}` : '—'}
              endContent={<Text color="accent">{t('book.change')}</Text>}
              onClick={() => go({ service: null, slot: null, date: null })}
            />
            <ListItem
              label={t('book.summary.barber')}
              description={barberParam === 'any' ? t('book.anyBarber') : (barber?.name ?? '—')}
              endContent={service ? <Text color="accent">{t('book.change')}</Text> : undefined}
              onClick={service ? () => go({ barber: null, slot: null, date: null }) : undefined}
              isDisabled={!service}
            />
            <ListItem
              label={t('book.summary.time')}
              description={summaryTime ?? '—'}
              endContent={service && barberChosen ? <Text color="accent">{t('book.change')}</Text> : undefined}
              onClick={service && barberChosen ? () => go({ slot: null }) : undefined}
              isDisabled={!service || !barberChosen}
            />
          </List>
          <Text type="supporting">{t('app.tzNote', { tz })}</Text>
        </VStack>
      </Section>

      {/* Step 1: service */}
      <Sheet open={step === 'service'} onOpenChange={(o) => !o && close()} title={t('book.step.service')} testId="sheet-service">
        <List hasDividers density="spacious">
          {servicesForStep.map((s) => (
            <ListItem
              key={s.id}
              label={s.name}
              description={[t('app.minutes', { n: s.duration_min }), s.description].filter(Boolean).join(' · ')}
              endContent={<Text weight="semibold" hasTabularNumbers>{fmtMoney(s.price_cents, shop.tenant.currency, intl)}</Text>}
              onClick={() => go({ service: s.id, slot: null, date: null })}
            />
          ))}
        </List>
      </Sheet>

      {/* Step 2: barber or "any available" */}
      <Sheet
        open={step === 'barber'}
        onOpenChange={(o) => !o && close()}
        title={t('book.step.barber')}
        description={service?.name}
        testId="sheet-barber"
      >
        <List hasDividers density="spacious">
          <ListItem
            label={t('book.anyBarber')}
            description={t('book.anyBarberHint')}
            startContent={<span className="flex size-10 items-center justify-center rounded-full bg-muted text-secondary"><Users aria-hidden size={20} /></span>}
            onClick={() => go({ barber: 'any', slot: null, date: null })}
            data-testid="barber-any"
          />
          {eligibleBarbers.map((b) => (
            <ListItem
              key={b.id}
              label={b.name}
              description={[b.title, b.specialties.slice(0, 3).join(', ')].filter(Boolean).join(' · ')}
              startContent={<Avatar src={mediaUrl(b.photo_path) ?? undefined} name={b.name} size="md" tooltip={false} />}
              endContent={b.works_today ? <Text type="supporting">{t('shop.worksToday')}</Text> : undefined}
              onClick={() => go({ barber: b.id, slot: null, date: null })}
              data-testid={`barber-${b.id}`}
            />
          ))}
        </List>
        {eligibleBarbers.length === 0 ? <Text color="secondary">{t('services.noBarber')}</Text> : null}
      </Sheet>

      {/* Step 3: date & time (server-computed availability only) */}
      <Sheet
        open={step === 'time'}
        onOpenChange={(o) => !o && close()}
        title={t('book.step.time')}
        description={[service?.name, barberParam === 'any' ? t('book.anyBarber') : barber?.name].filter(Boolean).join(' · ')}
        testId="sheet-time"
      >
        <VStack gap={3}>
          {flowError ? <Banner status="warning" title={flowError} /> : null}
          {service && barberChosen ? (
            <TimePicker
              serviceId={service.id}
              barberId={barberParam === 'any' ? null : barberParam}
              date={date}
              selected={slot}
              onDateChange={(d) => go({ date: d }, true)}
              onSelect={(startsAt, _local, d) => go({ slot: startsAt, date: d })}
            />
          ) : null}
        </VStack>
      </Sheet>

      {/* Step 4: client details + confirm */}
      <Sheet
        open={step === 'details'}
        onOpenChange={(o) => !o && !create.isPending && close()}
        title={t('book.step.details')}
        description={summaryTime ?? undefined}
        testId="sheet-details"
        footer={
          <Button
            label={create.isPending ? t('book.submitting') : t('book.submit')}
            variant="primary"
            size="lg"
            width="100%"
            isLoading={create.isPending}
            icon={<Icon icon={Check} />}
            onClick={submit}
            data-testid="confirm-booking"
          />
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          noValidate
        >
          <VStack gap={4} ref={firstFieldRef}>
            {flowError ? <Banner status="error" title={flowError} /> : null}
            <HStack gap={2} vAlign="center">
              <Icon icon={Users} size="sm" color="secondary" />
              <Text type="supporting">
                {service?.name} · {barberParam === 'any' ? t('book.anyBarber') : barber?.name}
              </Text>
            </HStack>
            <TextInput
              label={t('book.name')}
              value={form.name}
              onChange={(v) => setForm((f) => ({ ...f, name: v }))}
              autoComplete="name"
              isRequired
              status={fieldErr.name ? { type: 'error', message: fieldErr.name } : undefined}
              width="100%"
              htmlName="name"
            />
            <PhoneField
              label={t('book.phone')}
              value={form.phone}
              onChange={(v) => setForm((f) => ({ ...f, phone: v }))}
              isRequired
              status={fieldErr.phone ? { type: 'error', message: fieldErr.phone } : undefined}
              testId="phone-input"
            />
            <TextInput
              type="email"
              label={t('book.email')}
              description={t('book.emailHint')}
              value={form.email}
              onChange={(v) => setForm((f) => ({ ...f, email: v }))}
              autoComplete="email"
              isOptional
              status={fieldErr.email ? { type: 'error', message: fieldErr.email } : undefined}
              width="100%"
              htmlName="email"
            />
            <VStack gap={1}>
              <Text type="supporting">
                {rules.allow_self_cancel
                  ? t('book.policy.cancel', { hours: fmtHoursFromMinutes(rules.cancel_min_notice_min, intl) })
                  : t('book.policy.noCancel')}
              </Text>
              {rules.allow_self_reschedule ? (
                <Text type="supporting">{t('book.policy.reschedule', { hours: fmtHoursFromMinutes(rules.reschedule_min_notice_min, intl) })}</Text>
              ) : null}
            </VStack>
            <button type="submit" hidden aria-hidden tabIndex={-1} />
          </VStack>
        </form>
      </Sheet>
    </VStack>
  );
}
