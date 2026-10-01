import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { FileInput } from '@astryxdesign/core/FileInput';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon } from '@astryxdesign/core/Icon';
import { Section } from '@astryxdesign/core/Section';
import { Selector } from '@astryxdesign/core/Selector';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useToast } from '@astryxdesign/core/Toast';
import { VStack } from '@astryxdesign/core/VStack';
import { Eye, EyeOff, Image as ImageIcon, Trash2, Upload } from 'lucide-react';
import { useTenant } from '@/app/tenant';
import { useI18n, type MessageKey } from '@/lib/i18n';
import { mediaUrl } from '@/lib/media';
import { Empty, errorText } from '@/components/States';
import { useOwner } from '../context';
import { PageHeader } from '../ui';
import { deleteTenantImage, uploadTenantImage } from '../upload';

/** Owner-uploaded photos survive config republishing; pipeline photos follow business.json. */
export function PhotosPage() {
  const { slug } = useTenant();
  const { t } = useI18n();
  const { api, workspace, tenantId, refreshWorkspace } = useOwner();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState('interior');
  const [alt, setAlt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<string | null>(null);

  const done = async () => {
    await refreshWorkspace();
    void queryClient.invalidateQueries({ queryKey: ['shop', slug] });
  };
  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('invalid_input');
      const path = await uploadTenantImage(slug, tenantId, file, 1600);
      await api.addPhoto(kind, path, alt.trim());
    },
    onSuccess: async () => {
      setFile(null);
      setAlt('');
      setError(null);
      await done();
      showToast({ body: t('app.saved') });
    },
    onError: (e) => setError(e instanceof Error && e.message === 'too_large' ? t('photos.tooLarge') : errorText(t, e)),
  });
  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.updatePhoto(id, { is_active: active }),
    onSuccess: done,
    onError: (e) => showToast({ body: errorText(t, e), type: 'error' }),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const path = await api.deletePhoto(id);
      await deleteTenantImage(slug, path).catch(() => undefined);
    },
    onSuccess: async () => {
      setToDelete(null);
      await done();
    },
    onError: (e) => showToast({ body: errorText(t, e), type: 'error' }),
  });

  return (
    <VStack gap={0}>
      <PageHeader title={t('owner.nav.photos')} />
      <Section padding={4} paddingBlockStart={0}>
        <Card padding={4}>
          <VStack gap={3}>
            {error ? <Banner status="error" title={error} /> : null}
            <FileInput label={t('photos.upload')} accept="image/jpeg,image/png,image/webp" value={file} onChange={(f) => setFile(Array.isArray(f) ? (f[0] ?? null) : f)} mode="dropzone" maxSize={20 * 1024 * 1024} />
            <HStack gap={2} wrap="wrap">
              <Selector
                label={t('photos.kind')}
                options={(['cover', 'interior', 'work'] as const).map((k) => ({ value: k, label: t(`photos.kind.${k}` as MessageKey) }))}
                value={kind}
                onChange={setKind}
                width={200}
              />
              <TextInput label={t('photos.alt')} value={alt} onChange={setAlt} width={280} />
            </HStack>
            <Button label={t('photos.upload')} icon={<Icon icon={Upload} />} variant="primary" isDisabled={!file} isLoading={upload.isPending} onClick={() => upload.mutate()} />
          </VStack>
        </Card>
      </Section>
      <Section padding={4}>
        {workspace.photos.length === 0 ? (
          <Empty title={t('photos.empty')} icon={<Icon icon={ImageIcon} />} />
        ) : (
          <Grid columns={{ minWidth: 220 }} gap={3}>
            {workspace.photos.map((p) => (
              <Card key={p.id} padding={2}>
                <VStack gap={2}>
                  <img src={mediaUrl(p.storage_path) ?? ''} alt={p.alt} loading="lazy" className={`aspect-[4/3] w-full rounded-md object-cover ${p.is_active ? '' : 'opacity-40'}`} />
                  <HStack gap={1} wrap="wrap">
                    <Badge label={t(`photos.kind.${p.kind}` as MessageKey)} />
                    <Badge label={p.source === 'owner' ? t('photos.fromOwner') : t('photos.fromConfig')} variant={p.source === 'owner' ? 'info' : 'neutral'} />
                    {!p.is_active ? <Badge label={t('photos.hidden')} variant="warning" /> : null}
                  </HStack>
                  <HStack gap={1}>
                    <Button
                      label={p.is_active ? t('photos.hide') : t('photos.show')}
                      icon={<Icon icon={p.is_active ? EyeOff : Eye} />}
                      size="sm"
                      onClick={() => toggle.mutate({ id: p.id, active: !p.is_active })}
                    />
                    <Button label={t('app.delete')} icon={<Icon icon={Trash2} />} size="sm" variant="ghost" onClick={() => setToDelete(p.id)} />
                  </HStack>
                </VStack>
              </Card>
            ))}
          </Grid>
        )}
      </Section>
      <AlertDialog
        isOpen={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`${t('app.delete')}?`}
        description={workspace.photos.find((p) => p.id === toDelete)?.alt ?? ''}
        actionLabel={t('app.delete')}
        cancelLabel={t('app.cancel')}
        isActionLoading={remove.isPending}
        onAction={() => toDelete && remove.mutate(toDelete)}
      />
    </VStack>
  );
}
