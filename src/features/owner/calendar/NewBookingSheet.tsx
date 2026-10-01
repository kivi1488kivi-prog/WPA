import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { DateInput } from '@astryxdesign/core/DateInput';
import { HStack } from '@astryxdesign/core/HStack';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { TimeInput } from '@astryxdesign/core/TimeInput';
import { useToast } from '@astryxdesign/core/Toast';
import { VStack } from '@astryxdesign/core/VStack';
import { useTenant } from '@/app/tenant';
import { useI18n } from '@/lib/i18n';
import { publicApi } from '@/lib/api/public';
import { newKey } from '@/lib/idempotency';
import { hhmmToMin, zonedToUtc } from '@/lib/time';
import { Sheet } from '@/components/Sheet';
import { PhoneField } from '@/components/PhoneField';
import { errorText } from '@/components/States';
import { can, useOwner } from '../context';
import { asDate, asTime } from '../ui';

export interface NewBookingPrefill {
  barberId?: string;
  date: string;
  time?: string;
}

/** Manual booking by staff. Same SQL transaction & EXCLUDE guarantees as online booking. */
export function NewBookingSheet({ prefill, onClose }: { prefill: NewBookingPrefill | null; onClose: () => void }) {
  const { slug, tz } = useTenant();
  const { t } = useI18n();
  const { api, role, myBarberId, workspace, tenantId } = useOwner();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const services = workspace.services.filter((s) => s.is_active);
  const [serviceId, setServiceId] = useState(services[0]?.id ?? '');
  const [barberId, setBarberId] = useState<string>('');
  const [date, setDate] = useState(workspace.today);
  const [time, setTime] = useState('10:00');
  const [ignoreHours, setIgnoreHours] = useState(false);
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [customerId, setCustomerId] = useState('');
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(newKey);

  useEffect(() => {
    if (!prefill) return;
    setDate(prefill.date);
    if (prefill.time) setTime(prefill.time);
    setBarberId(role === 'barber' ? (myBarberId ?? '') : (prefill.barberId ?? ''));
    if (prefill.barberId) {
      const first = services.find((s) => s.barber_ids.includes(prefill.barberId as string));
      if (first) setServiceId(first.id);
    }
    setError(null);
    setKey(newKey());
  }, [prefill]); // eslint-disable-line react-hooks/exhaustive-deps

  const eligible = workspace.barbers.filter((b) => b.is_active && b.service_ids.includes(serviceId) && (role !== 'barber' || b.id === myBarberId));
  const suggestions = useQuery({
    queryKey: ['owner-suggest', slug, serviceId, barberId, date],
    queryFn: () => publicApi.slots(slug, serviceId, barberId || null, date),
    enabled: !!prefill && !!serviceId,
  });
  const customers = useQuery({
    queryKey: ['owner', tenantId, 'customers', search],
    queryFn: () => api.customers(search),
    enabled: !!prefill && mode === 'existing',
  });

  const m = useMutation({
    mutationFn: () => {
      const minutes = hhmmToMin(time);
      if (minutes === null) throw new Error('invalid_input');
      return api.createBooking({
        serviceId,
        barberId: barberId || null,
        startsAt: zonedToUtc(date, minutes, tz).toISOString(),
        customer: mode === 'existing' ? { id: customerId } : { name: name.trim(), phone: phone.trim(), email: email.trim() || null },
        note,
        ignoreHours,
        key,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['owner', tenantId] });
      void queryClient.invalidateQueries({ queryKey: ['slots', slug] });
      showToast({ body: t('bk.created') });
      setName('');
      setPhone('');
      setEmail('');
      setNote('');
      onClose();
    },
    onError: (e) => setError(errorText(t, e)),
  });

  return (
    <Sheet
      open={!!prefill}
      onOpenChange={(o) => !o && onClose()}
      title={t('cal.newBooking')}
      testId="owner-new-booking"
      footer={<Button label={t('app.save')} variant="primary" size="lg" width="100%" isLoading={m.isPending} onClick={() => m.mutate()} data-testid="owner-save-booking" />}
    >
      <VStack gap={3}>
        {error ? <Banner status="error" title={error} /> : null}
        <Selector
          label={t('booking.service')}
          options={services.map((s) => ({ value: s.id, label: `${s.name} · ${t('app.minutes', { n: s.duration_min })}` }))}
          value={serviceId}
          onChange={(v) => {
            setServiceId(v);
            setBarberId(role === 'barber' ? (myBarberId ?? '') : '');
          }}
          width="100%"
        />
        <Selector
          label={t('booking.with')}
          options={[...(role === 'barber' ? [] : [{ value: '', label: t('book.anyBarber') }]), ...eligible.map((b) => ({ value: b.id, label: b.name }))]}
          value={barberId}
          onChange={setBarberId}
          width="100%"
        />
        <DateInput label={t('bk.date')} value={asDate(date)} onChange={(v) => v && setDate(v)} width="100%" weekStartsOn="mon" />
        <TimeInput label={t('bk.time')} value={asTime(time)} onChange={(v) => v && setTime(v)} hourFormat="24h" increment={5} width="100%" />
        {suggestions.data && suggestions.data.slots.length > 0 ? (
          <VStack gap={1}>
            <Text type="supporting">{t('bk.suggested')}</Text>
            <HStack gap={1} wrap="wrap">
              {suggestions.data.slots.slice(0, 24).map((s) => (
                <Button key={s.starts_at} label={s.local_time} size="sm" variant={s.local_time === time ? 'primary' : 'secondary'} onClick={() => setTime(s.local_time)} />
              ))}
            </HStack>
          </VStack>
        ) : null}
        {can(role, 'manage') ? <Switch label={t('bk.ignoreHours')} value={ignoreHours} onChange={setIgnoreHours} /> : null}

        <SegmentedControl label={t('bk.client')} value={mode} onChange={(v) => setMode(v as 'new' | 'existing')} layout="fill">
          <SegmentedControlItem value="new" label={t('bk.customerNew')} />
          <SegmentedControlItem value="existing" label={t('bk.customerExisting')} />
        </SegmentedControl>
        {mode === 'new' ? (
          <>
            <TextInput label={t('book.name')} value={name} onChange={setName} width="100%" isRequired />
            <PhoneField label={t('book.phone')} value={phone} onChange={setPhone} isRequired testId="owner-phone" />
            <TextInput type="email" label={t('book.email')} value={email} onChange={setEmail} width="100%" isOptional />
          </>
        ) : (
          <>
            <TextInput label={t('clients.search')} value={search} onChange={setSearch} width="100%" hasClear />
            <Selector
              label={t('bk.client')}
              options={(customers.data ?? []).map((c) => ({ value: c.id, label: `${c.name} · ${c.phone}` }))}
              value={customerId}
              onChange={setCustomerId}
              width="100%"
              isLoading={customers.isFetching}
            />
          </>
        )}
        <TextInput label={t('bk.note')} value={note} onChange={setNote} width="100%" isOptional />
      </VStack>
    </Sheet>
  );
}
