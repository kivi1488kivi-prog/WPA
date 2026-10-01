import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Section } from '@astryxdesign/core/Section';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useToast } from '@astryxdesign/core/Toast';
import { VStack } from '@astryxdesign/core/VStack';
import { useTenant } from '@/app/tenant';
import { useI18n, type MessageKey } from '@/lib/i18n';
import { errorText } from '@/components/States';
import { can, useOwner } from '../context';
import { PageHeader } from '../ui';
import { WeekEditor, type Interval } from '../WeekEditor';

function Block({ title, children, onSave, busy, disabled }: { title: string; children: ReactNode; onSave?: () => void; busy?: boolean; disabled?: boolean }) {
  const { t } = useI18n();
  return (
    <Section padding={4} dividers={['bottom']}>
      <VStack gap={3} className="max-w-2xl">
        <Heading level={2}>{title}</Heading>
        {children}
        {onSave ? <Button label={t('app.save')} variant="primary" isLoading={busy} isDisabled={disabled} onClick={onSave} /> : null}
      </VStack>
    </Section>
  );
}

export function SettingsPage() {
  const { slug } = useTenant();
  const { t } = useI18n();
  const { api, workspace, role, refreshWorkspace, tenantId } = useOwner();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const isOwner = can(role, 'settings');
  const tn = workspace.tenant;
  const im = tn.legal.impressum ?? {};
  const pr = tn.legal.privacy ?? {};

  const [g, setG] = useState({
    name: tn.name, short_name: tn.short_name, tagline: tn.tagline ?? '', description: tn.description ?? '', phone: tn.phone ?? '',
    email: tn.email ?? '', address_line: tn.address_line ?? '', city: tn.city ?? '', map_url: tn.map_url ?? '', instagram: tn.instagram ?? '',
    website: tn.website ?? '', accent_color: tn.accent_color, locale: tn.locale,
  });
  const [r, setR] = useState({
    slot_step_min: String(tn.slot_step_min), min_lead_min: tn.min_lead_min, max_advance_days: tn.max_advance_days, allow_self_cancel: tn.allow_self_cancel,
    cancel_min_notice_min: tn.cancel_min_notice_min, allow_self_reschedule: tn.allow_self_reschedule, reschedule_min_notice_min: tn.reschedule_min_notice_min,
    max_self_reschedules: tn.max_self_reschedules,
  });
  const [n, setN] = useState({ reminders: tn.reminder_offsets_min.join(', '), notify_staff: tn.notify_staff, ai_enabled: tn.ai_enabled });
  const [l, setL] = useState({
    legal_name: im.legal_name ?? '', legal_form: im.legal_form ?? '', represented_by: im.represented_by ?? '', street: im.street ?? '',
    postal_code: im.postal_code ?? '', city: im.city ?? '', country: im.country ?? 'Deutschland', email: im.email ?? '', phone: im.phone ?? '',
    register_court: im.register?.court ?? '', register_number: im.register?.number ?? '', vat_id: im.vat_id ?? '',
    profession_title: im.profession?.title ?? '', chamber: im.profession?.chamber ?? '', dispute: im.dispute_resolution ?? 'not_willing',
    supervisory: pr.supervisory_authority ?? '', retention: tn.retention_months,
  });
  const [hours, setHours] = useState<Interval[]>(workspace.opening_hours.map((h) => ({ weekday: h.weekday, start_min: h.start_min, end_min: h.end_min })));
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: async () => {
      setError(null);
      await refreshWorkspace();
      void queryClient.invalidateQueries({ queryKey: ['shop', slug] });
      void queryClient.invalidateQueries({ queryKey: ['owner', tenantId] });
      showToast({ body: t('app.saved') });
    },
    onError: (e) => setError(errorText(t, e)),
  });
  const golive = useQuery({ queryKey: ['owner', tenantId, 'golive'], queryFn: () => api.goLiveCheck(), enabled: tn.status === 'preview' });
  const goLive = useMutation({
    mutationFn: () => api.goLive(),
    onSuccess: async () => {
      await refreshWorkspace();
      void queryClient.invalidateQueries({ queryKey: ['shop', slug] });
      showToast({ body: t('settings.live') });
    },
    onError: (e) => setError(errorText(t, e)),
  });

  const txt = (label: MessageKey, value: string, set: (v: string) => void, opts: { area?: boolean; required?: boolean } = {}) =>
    opts.area ? (
      <TextArea label={t(label)} value={value} onChange={set} rows={3} width="100%" isReadOnly={!isOwner} />
    ) : (
      <TextInput label={t(label)} value={value} onChange={set} width="100%" isReadOnly={!isOwner} isRequired={opts.required} />
    );
  const legalPatch = () => ({
    legal: {
      impressum: {
        legal_name: l.legal_name, legal_form: l.legal_form || undefined, represented_by: l.represented_by || undefined, street: l.street,
        postal_code: l.postal_code, city: l.city, country: l.country, email: l.email, phone: l.phone || undefined,
        register: l.register_court && l.register_number ? { court: l.register_court, number: l.register_number } : undefined,
        vat_id: l.vat_id || undefined,
        profession: l.profession_title && l.chamber ? { ...(im.profession ?? {}), title: l.profession_title, chamber: l.chamber } : undefined,
        content_responsible: im.content_responsible, dispute_resolution: l.dispute,
      },
      privacy: { ...pr, supervisory_authority: l.supervisory || undefined, retention_months: l.retention },
    },
    retention_months: l.retention,
  });

  return (
    <VStack gap={0}>
      <PageHeader title={t('owner.nav.settings')} subtitle={t('settings.status', { status: tn.status })} />
      {error ? <Banner status="error" title={error} container="section" /> : null}
      {!isOwner ? <Banner status="info" title={t('settings.ownerOnly')} container="section" /> : null}

      {tn.status === 'preview' ? (
        <Block title={t('settings.golive')}>
          <Text>{t('settings.goLiveHint')}</Text>
          {golive.data && golive.data.problems.length > 0 ? (
            <VStack gap={1}>
              {golive.data.problems.map((p) => (
                <Text key={p}>• {t(`settings.problem.${p}` as MessageKey)}</Text>
              ))}
            </VStack>
          ) : golive.data ? (
            <Text>{t('settings.ready')}</Text>
          ) : null}
          {isOwner ? (
            <Button label={t('settings.goLiveBtn')} variant="primary" isDisabled={!golive.data || golive.data.problems.length > 0} isLoading={goLive.isPending} onClick={() => goLive.mutate()} />
          ) : null}
        </Block>
      ) : null}

      <Block title={t('settings.general')} onSave={isOwner ? () => save.mutate(() => api.updateSettings(g)) : undefined} busy={save.isPending}>
        {txt('settings.name', g.name, (v) => setG({ ...g, name: v }), { required: true })}
        {txt('settings.shortName', g.short_name, (v) => setG({ ...g, short_name: v }), { required: true })}
        {txt('settings.tagline', g.tagline, (v) => setG({ ...g, tagline: v }))}
        {txt('settings.description', g.description, (v) => setG({ ...g, description: v }), { area: true })}
        {txt('settings.phone', g.phone, (v) => setG({ ...g, phone: v }))}
        {txt('settings.email', g.email, (v) => setG({ ...g, email: v }))}
        {txt('settings.address', g.address_line, (v) => setG({ ...g, address_line: v }))}
        {txt('settings.city', g.city, (v) => setG({ ...g, city: v }))}
        {txt('settings.mapUrl', g.map_url, (v) => setG({ ...g, map_url: v }))}
        {txt('settings.instagram', g.instagram, (v) => setG({ ...g, instagram: v }))}
        {txt('settings.website', g.website, (v) => setG({ ...g, website: v }))}
        {txt('settings.accent', g.accent_color, (v) => setG({ ...g, accent_color: v }))}
        <Selector
          label={t('settings.language')}
          options={[{ value: 'de', label: 'Deutsch' }, { value: 'en', label: 'English' }, { value: 'ru', label: 'Русский' }]}
          value={g.locale}
          onChange={(v) => setG({ ...g, locale: v as typeof g.locale })}
          isReadOnly={!isOwner}
          width="100%"
        />
      </Block>

      <Block title={t('shop.hours')} onSave={() => save.mutate(() => api.setOpeningHours(hours))} busy={save.isPending}>
        <WeekEditor value={hours} onChange={setHours} addLabel={t('barbers.addInterval')} idPrefix="opening" />
      </Block>

      <Block
        title={t('settings.rules')}
        busy={save.isPending}
        onSave={isOwner ? () => save.mutate(() => api.updateSettings({ ...r, slot_step_min: Number(r.slot_step_min) })) : undefined}
      >
        <Selector label={t('settings.step')} options={['5', '10', '15', '20', '30', '60'].map((v) => ({ value: v, label: v }))} value={r.slot_step_min} onChange={(v) => setR({ ...r, slot_step_min: v })} isReadOnly={!isOwner} width="100%" />
        <NumberInput label={t('settings.lead')} value={r.min_lead_min} onChange={(v) => setR({ ...r, min_lead_min: v })} min={0} isIntegerOnly isReadOnly={!isOwner} width="100%" />
        <NumberInput label={t('settings.advance')} value={r.max_advance_days} onChange={(v) => setR({ ...r, max_advance_days: v })} min={1} max={365} isIntegerOnly isReadOnly={!isOwner} width="100%" />
        <Switch label={t('settings.allowCancel')} value={r.allow_self_cancel} onChange={(v) => setR({ ...r, allow_self_cancel: v })} isDisabled={!isOwner} />
        <NumberInput label={t('settings.cancelNotice')} value={r.cancel_min_notice_min} onChange={(v) => setR({ ...r, cancel_min_notice_min: v })} min={0} isIntegerOnly isReadOnly={!isOwner} width="100%" />
        <Switch label={t('settings.allowReschedule')} value={r.allow_self_reschedule} onChange={(v) => setR({ ...r, allow_self_reschedule: v })} isDisabled={!isOwner} />
        <NumberInput label={t('settings.rescheduleNotice')} value={r.reschedule_min_notice_min} onChange={(v) => setR({ ...r, reschedule_min_notice_min: v })} min={0} isIntegerOnly isReadOnly={!isOwner} width="100%" />
        <NumberInput label={t('settings.maxReschedules')} value={r.max_self_reschedules} onChange={(v) => setR({ ...r, max_self_reschedules: v })} min={0} max={20} isIntegerOnly isReadOnly={!isOwner} width="100%" />
      </Block>

      <Block
        title={`${t('settings.notifications')} · ${t('settings.ai')}`}
        busy={save.isPending}
        onSave={
          isOwner
            ? () =>
                save.mutate(() =>
                  api.updateSettings({
                    reminder_offsets_min: n.reminders.split(',').map((x) => Number(x.trim())).filter((x) => Number.isFinite(x) && x > 0),
                    notify_staff: n.notify_staff,
                    ai_enabled: n.ai_enabled,
                  }),
                )
            : undefined
        }
      >
        {txt('settings.reminders', n.reminders, (v) => setN({ ...n, reminders: v }))}
        <Switch label={t('settings.notifyStaff')} value={n.notify_staff} onChange={(v) => setN({ ...n, notify_staff: v })} isDisabled={!isOwner} />
        <Switch label={t('settings.aiEnabled')} value={n.ai_enabled} onChange={(v) => setN({ ...n, ai_enabled: v })} isDisabled={!isOwner} />
      </Block>

      <Block title={t('settings.legal')} busy={save.isPending} onSave={isOwner ? () => save.mutate(() => api.updateSettings(legalPatch())) : undefined}>
        {txt('settings.legalName', l.legal_name, (v) => setL({ ...l, legal_name: v }), { required: true })}
        {txt('settings.legalForm', l.legal_form, (v) => setL({ ...l, legal_form: v }))}
        {txt('settings.representedBy', l.represented_by, (v) => setL({ ...l, represented_by: v }))}
        {txt('settings.street', l.street, (v) => setL({ ...l, street: v }), { required: true })}
        {txt('settings.postalCode', l.postal_code, (v) => setL({ ...l, postal_code: v }), { required: true })}
        {txt('settings.city', l.city, (v) => setL({ ...l, city: v }), { required: true })}
        {txt('settings.legalEmail', l.email, (v) => setL({ ...l, email: v }), { required: true })}
        {txt('settings.legalPhone', l.phone, (v) => setL({ ...l, phone: v }))}
        {txt('settings.registerCourt', l.register_court, (v) => setL({ ...l, register_court: v }))}
        {txt('settings.registerNumber', l.register_number, (v) => setL({ ...l, register_number: v }))}
        {txt('settings.vatId', l.vat_id, (v) => setL({ ...l, vat_id: v }))}
        {txt('settings.professionTitle', l.profession_title, (v) => setL({ ...l, profession_title: v }))}
        {txt('settings.chamber', l.chamber, (v) => setL({ ...l, chamber: v }))}
        {txt('settings.supervisory', l.supervisory, (v) => setL({ ...l, supervisory: v }))}
        <NumberInput label={t('settings.retention')} value={l.retention} onChange={(v) => setL({ ...l, retention: v })} min={6} max={120} isIntegerOnly isReadOnly={!isOwner} width="100%" />
        <Text type="supporting">{t('legal.notLegalAdvice')}</Text>
      </Block>
    </VStack>
  );
}
