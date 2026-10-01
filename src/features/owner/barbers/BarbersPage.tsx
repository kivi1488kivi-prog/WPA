import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { FileInput } from '@astryxdesign/core/FileInput';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon } from '@astryxdesign/core/Icon';
import { List, ListItem } from '@astryxdesign/core/List';
import { Section } from '@astryxdesign/core/Section';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useToast } from '@astryxdesign/core/Toast';
import { VStack } from '@astryxdesign/core/VStack';
import { Plus, UserRound } from 'lucide-react';
import { useTenant } from '@/app/tenant';
import { useI18n } from '@/lib/i18n';
import { mediaUrl } from '@/lib/media';
import type { OwnerBarber } from '@/lib/api/owner';
import { Sheet } from '@/components/Sheet';
import { Empty, errorText } from '@/components/States';
import { useOwner } from '../context';
import { PageHeader } from '../ui';
import { WeekEditor, type Interval } from '../WeekEditor';
import { uploadTenantImage } from '../upload';

// Accessible palette for calendar markers; the marker text/initials keep the
// calendar usable without color.
const SWATCHES = ['#E07A5F', '#81B29A', '#F2CC8F', '#3D85C6', '#9C89B8', '#E06C9F', '#4ECDC4', '#C8A165'];

export function BarbersPage() {
  const { t } = useI18n();
  const { workspace } = useOwner();
  const [editing, setEditing] = useState<OwnerBarber | 'new' | null>(null);
  return (
    <VStack gap={0}>
      <PageHeader title={t('owner.nav.barbers')} actions={<Button label={t('barbers.add')} icon={<Icon icon={Plus} />} variant="primary" onClick={() => setEditing('new')} />} />
      <Section padding={4} paddingBlockStart={0}>
        {workspace.barbers.length === 0 ? (
          <Empty title={t('barbers.empty')} icon={<Icon icon={UserRound} />} />
        ) : (
          <List hasDividers>
            {workspace.barbers.map((b) => (
              <ListItem
                key={b.id}
                label={b.name}
                description={[b.title, `${b.service_ids.length} ${t('owner.nav.services')}`, b.is_active ? t('barbers.active') : t('barbers.inactive')].filter(Boolean).join(' · ')}
                startContent={<Avatar src={mediaUrl(b.photo_path) ?? undefined} name={b.name} size="md" tooltip={false} />}
                endContent={
                  <HStack gap={1} vAlign="center">
                    <span className="flex size-7 items-center justify-center rounded-full text-xs font-bold text-body" style={{ backgroundColor: b.color }} aria-hidden>{b.marker}</span>
                    <StatusDot variant={b.is_active ? 'success' : 'neutral'} label={b.is_active ? t('barbers.active') : t('barbers.inactive')} />
                  </HStack>
                }
                onClick={() => setEditing(b)}
              />
            ))}
          </List>
        )}
      </Section>
      <BarberEditor barber={editing} onClose={() => setEditing(null)} />
    </VStack>
  );
}

function BarberEditor({ barber, onClose }: { barber: OwnerBarber | 'new' | null; onClose: () => void }) {
  const { slug } = useTenant();
  const { t } = useI18n();
  const { api, workspace, tenantId, refreshWorkspace } = useOwner();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const isNew = barber === 'new';
  const b = barber && barber !== 'new' ? barber : null;
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [bio, setBio] = useState('');
  const [specialties, setSpecialties] = useState('');
  const [color, setColor] = useState(SWATCHES[0]!);
  const [marker, setMarker] = useState('');
  const [active, setActive] = useState(true);
  const [photo, setPhoto] = useState<string | null>(null);
  const [services, setServices] = useState<string[]>([]);
  const [hours, setHours] = useState<Interval[]>([]);
  const [breaks, setBreaks] = useState<Interval[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!barber) return;
    setName(b?.name ?? '');
    setTitle(b?.title ?? '');
    setBio(b?.bio ?? '');
    setSpecialties((b?.specialties ?? []).join(', '));
    setColor(b?.color ?? SWATCHES[workspace.barbers.length % SWATCHES.length]!);
    setMarker(b?.marker ?? '');
    setActive(b?.is_active ?? true);
    setPhoto(b?.photo_path ?? null);
    setServices(b?.service_ids ?? []);
    setHours(b?.weekly_hours ?? []);
    setBreaks(b?.weekly_breaks ?? []);
    setFile(null);
    setError(null);
  }, [barber]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: async () => {
      let photoPath = photo;
      if (file) photoPath = await uploadTenantImage(slug, tenantId, file, 800);
      const id = await api.upsertBarber({
        ...(b ? { id: b.id } : {}),
        name: name.trim(),
        title: title.trim() || null,
        bio: bio.trim() || null,
        specialties: specialties.split(',').map((s) => s.trim()).filter(Boolean),
        color,
        marker: marker.trim().slice(0, 3),
        is_active: active,
        ...(photoPath !== (b?.photo_path ?? null) ? { photo_path: photoPath ?? '' } : {}),
      });
      await api.setBarberServices(id, services);
      await api.setBarberSchedule(id, hours.map(({ weekday, start_min, end_min }) => ({ weekday, start_min, end_min })), breaks);
    },
    onSuccess: async () => {
      await refreshWorkspace();
      void queryClient.invalidateQueries({ queryKey: ['owner', tenantId] });
      void queryClient.invalidateQueries({ queryKey: ['shop', slug] });
      showToast({ body: t('app.saved') });
      onClose();
    },
    onError: (e) => setError(e instanceof Error && e.message === 'too_large' ? t('photos.tooLarge') : errorText(t, e)),
  });

  return (
    <Sheet
      open={!!barber}
      onOpenChange={(o) => !o && onClose()}
      title={isNew ? t('barbers.add') : (b?.name ?? '')}
      testId="barber-editor"
      footer={<Button label={t('app.save')} variant="primary" size="lg" width="100%" isLoading={save.isPending} isDisabled={!name.trim()} onClick={() => save.mutate()} />}
    >
      <VStack gap={4}>
        {error ? <Banner status="error" title={error} /> : null}
        {b?.managed_by === 'pipeline' ? <Text type="supporting">{t('photos.fromConfig')}</Text> : null}
        <Switch label={t('barbers.active')} value={active} onChange={setActive} />
        <TextInput label={t('barbers.name')} value={name} onChange={setName} isRequired width="100%" />
        <TextInput label={t('barbers.titleField')} value={title} onChange={setTitle} isOptional width="100%" />
        <TextArea label={t('barbers.bio')} value={bio} onChange={setBio} rows={3} isOptional width="100%" />
        <TextInput label={t('barbers.specialties')} value={specialties} onChange={setSpecialties} isOptional width="100%" />
        <HStack gap={4} vAlign="center" wrap="wrap">
          {photo || file ? <Avatar src={file ? URL.createObjectURL(file) : (mediaUrl(photo) ?? undefined)} name={name} size="xl" tooltip={false} /> : null}
          <FileInput label={t('barbers.photo')} accept="image/jpeg,image/png,image/webp" value={file} onChange={(f) => setFile(Array.isArray(f) ? (f[0] ?? null) : f)} maxSize={15 * 1024 * 1024} placeholder={t('barbers.uploadPhoto')} />
        </HStack>
        <VStack gap={2}>
          <Text type="label" id="color-label">{t('barbers.color')}</Text>
          <HStack gap={2} wrap="wrap" role="radiogroup" aria-labelledby="color-label">
            {SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={c === color}
                aria-label={c}
                onClick={() => setColor(c)}
                className={`size-9 rounded-full border-2 ${c === color ? 'border-primary' : 'border-transparent'}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </HStack>
          <TextInput label={t('barbers.marker')} value={marker} onChange={(v) => setMarker(v.slice(0, 3))} width={160} />
        </VStack>
        <VStack gap={2}>
          <Heading level={3}>{t('barbers.services')}</Heading>
          {workspace.services.map((s) => (
            <CheckboxInput
              key={s.id}
              label={s.is_active ? s.name : `${s.name} (${t('barbers.inactive')})`}
              value={services.includes(s.id)}
              onChange={(v) => setServices((cur) => (v ? [...cur, s.id] : cur.filter((x) => x !== s.id)))}
            />
          ))}
        </VStack>
        <VStack gap={2}>
          <Heading level={3}>{t('barbers.schedule')}</Heading>
          <WeekEditor value={hours} onChange={setHours} addLabel={t('barbers.addInterval')} idPrefix="hours" />
        </VStack>
        <VStack gap={2}>
          <Heading level={3}>{t('barbers.breaks')}</Heading>
          <WeekEditor value={breaks} onChange={setBreaks} addLabel={t('barbers.addBreak')} idPrefix="breaks" />
        </VStack>
      </VStack>
    </Sheet>
  );
}
