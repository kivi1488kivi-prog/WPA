import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Heading } from '@astryxdesign/core/Heading';
import { Icon } from '@astryxdesign/core/Icon';
import { List, ListItem } from '@astryxdesign/core/List';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Section } from '@astryxdesign/core/Section';
import { Selector } from '@astryxdesign/core/Selector';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useToast } from '@astryxdesign/core/Toast';
import { VStack } from '@astryxdesign/core/VStack';
import { Plus, Scissors } from 'lucide-react';
import { useTenant } from '@/app/tenant';
import { useI18n } from '@/lib/i18n';
import { fmtMoney, parseMoneyToCents } from '@/lib/money';
import type { OwnerService } from '@/lib/api/owner';
import { Sheet } from '@/components/Sheet';
import { Empty, errorText } from '@/components/States';
import { useOwner } from '../context';
import { PageHeader } from '../ui';

type Tri = 'inherit' | 'yes' | 'no';
const toTri = (v: boolean | null): Tri => (v === null ? 'inherit' : v ? 'yes' : 'no');
const fromTri = (v: Tri) => (v === 'inherit' ? null : v === 'yes');

export function ServicesPage() {
  const { intl } = useTenant();
  const { t } = useI18n();
  const { workspace } = useOwner();
  const [editing, setEditing] = useState<OwnerService | 'new' | null>(null);
  const activeBarbers = new Set(workspace.barbers.filter((b) => b.is_active).map((b) => b.id));
  return (
    <VStack gap={0}>
      <PageHeader title={t('owner.nav.services')} actions={<Button label={t('services.add')} icon={<Icon icon={Plus} />} variant="primary" onClick={() => setEditing('new')} />} />
      <Section padding={4} paddingBlockStart={0}>
        {workspace.services.length === 0 ? (
          <Empty title={t('services.empty')} icon={<Icon icon={Scissors} />} />
        ) : (
          <List hasDividers>
            {workspace.services.map((s) => {
              const noBarber = s.is_active && !s.barber_ids.some((id) => activeBarbers.has(id));
              return (
                <ListItem
                  key={s.id}
                  label={s.name}
                  description={[t('app.minutes', { n: s.duration_min }), s.buffer_min ? `+${s.buffer_min}` : null, noBarber ? t('services.noBarber') : null].filter(Boolean).join(' · ')}
                  startContent={<StatusDot variant={!s.is_active ? 'neutral' : noBarber ? 'warning' : 'success'} label={s.is_active ? t('services.active') : t('barbers.inactive')} />}
                  endContent={<Text weight="semibold" hasTabularNumbers>{fmtMoney(s.price_cents, workspace.tenant.currency, intl)}</Text>}
                  onClick={() => setEditing(s)}
                />
              );
            })}
          </List>
        )}
      </Section>
      <ServiceEditor service={editing} onClose={() => setEditing(null)} />
    </VStack>
  );
}

function ServiceEditor({ service, onClose }: { service: OwnerService | 'new' | null; onClose: () => void }) {
  const { slug } = useTenant();
  const { t } = useI18n();
  const { api, workspace, tenantId, refreshWorkspace } = useOwner();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const s = service && service !== 'new' ? service : null;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [duration, setDuration] = useState<number>(30);
  const [buffer, setBuffer] = useState<number>(0);
  const [price, setPrice] = useState('0');
  const [active, setActive] = useState(true);
  const [barbers, setBarbers] = useState<string[]>([]);
  const [cancel, setCancel] = useState<Tri>('inherit');
  const [resched, setResched] = useState<Tri>('inherit');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!service) return;
    setName(s?.name ?? '');
    setDescription(s?.description ?? '');
    setDuration(s?.duration_min ?? 30);
    setBuffer(s?.buffer_min ?? 0);
    setPrice(((s?.price_cents ?? 0) / 100).toFixed(2));
    setActive(s?.is_active ?? true);
    setBarbers(s?.barber_ids ?? []);
    setCancel(toTri(s?.allow_self_cancel ?? null));
    setResched(toTri(s?.allow_self_reschedule ?? null));
    setError(null);
  }, [service]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: async () => {
      const cents = parseMoneyToCents(price);
      if (cents === null) throw new Error('invalid_input');
      const id = await api.upsertService({
        ...(s ? { id: s.id } : {}),
        name: name.trim(),
        description: description.trim() || null,
        duration_min: duration,
        buffer_min: buffer,
        price_cents: cents,
        is_active: active,
        allow_self_cancel: fromTri(cancel),
        allow_self_reschedule: fromTri(resched),
      });
      // barber assignment is stored per barber: update each changed barber
      for (const b of workspace.barbers) {
        const has = b.service_ids.includes(id);
        const want = barbers.includes(b.id);
        if (has !== want) await api.setBarberServices(b.id, want ? [...b.service_ids, id] : b.service_ids.filter((x) => x !== id));
      }
    },
    onSuccess: async () => {
      await refreshWorkspace();
      void queryClient.invalidateQueries({ queryKey: ['owner', tenantId] });
      void queryClient.invalidateQueries({ queryKey: ['shop', slug] });
      showToast({ body: t('app.saved') });
      onClose();
    },
    onError: (e) => setError(errorText(t, e)),
  });

  const triOptions = [
    { value: 'inherit', label: t('services.inherit') },
    { value: 'yes', label: t('app.yes') },
    { value: 'no', label: t('app.no') },
  ];
  return (
    <Sheet
      open={!!service}
      onOpenChange={(o) => !o && onClose()}
      title={s ? s.name : t('services.add')}
      testId="service-editor"
      footer={<Button label={t('app.save')} variant="primary" size="lg" width="100%" isLoading={save.isPending} isDisabled={!name.trim()} onClick={() => save.mutate()} data-testid="service-save" />}
    >
      <VStack gap={4}>
        {error ? <Banner status="error" title={error} /> : null}
        <Switch label={t('services.active')} value={active} onChange={setActive} />
        <TextInput label={t('services.name')} value={name} onChange={setName} isRequired width="100%" />
        <TextArea label={t('services.description')} value={description} onChange={setDescription} rows={2} isOptional width="100%" />
        <NumberInput label={t('services.duration')} value={duration} onChange={setDuration} min={5} max={480} step={5} isIntegerOnly width="100%" />
        <NumberInput label={t('services.buffer')} value={buffer} onChange={setBuffer} min={0} max={120} step={5} isIntegerOnly width="100%" />
        <TextInput label={`${t('services.price')} (${workspace.tenant.currency})`} value={price} onChange={setPrice} width="100%" htmlName="price" />
        <VStack gap={2}>
          <Heading level={3}>{t('services.barbers')}</Heading>
          {workspace.barbers.map((b) => (
            <CheckboxInput
              key={b.id}
              label={b.is_active ? b.name : `${b.name} (${t('barbers.inactive')})`}
              value={barbers.includes(b.id)}
              onChange={(v) => setBarbers((cur) => (v ? [...cur, b.id] : cur.filter((x) => x !== b.id)))}
            />
          ))}
        </VStack>
        <VStack gap={2}>
          <Heading level={3}>{t('services.policy')}</Heading>
          <Selector label={t('services.allowCancel')} options={triOptions} value={cancel} onChange={(v) => setCancel(v as Tri)} width="100%" />
          <Selector label={t('services.allowReschedule')} options={triOptions} value={resched} onChange={(v) => setResched(v as Tri)} width="100%" />
        </VStack>
      </VStack>
    </Sheet>
  );
}
