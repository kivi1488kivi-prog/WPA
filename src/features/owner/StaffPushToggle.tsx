import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon } from '@astryxdesign/core/Icon';
import { Text } from '@astryxdesign/core/Text';
import { Bell, BellRing } from 'lucide-react';
import { useTenant } from '@/app/tenant';
import { useI18n } from '@/lib/i18n';
import { currentPushEndpoint, pushSupport, subscribePush } from '@/lib/push';
import { useOwner } from './context';

/** Staff device notifications (owner-scope service worker). Honest about support. */
export function StaffPushToggle() {
  const { slug } = useTenant();
  const { t } = useI18n();
  const { api } = useOwner();
  const support = pushSupport();
  const [on, setOn] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    void currentPushEndpoint(slug, 'owner').then((e) => setOn(!!e && Notification.permission === 'granted'));
  }, [slug]);
  const m = useMutation({
    mutationFn: async () => api.registerPush(await subscribePush(slug, 'owner')),
    onSuccess: () => setOn(true),
    onError: (e) => setFailed(e instanceof Error && e.message === 'denied' ? t('push.denied') : t('push.failed')),
  });
  if (support === 'not-configured') return <Text type="supporting">{t('push.notConfigured')}</Text>;
  if (support === 'ios-needs-install') return <Text type="supporting">{t('push.iosInstall')}</Text>;
  if (support === 'unsupported') return <Text type="supporting">{t('push.unsupported')}</Text>;
  if (on)
    return (
      <HStack gap={2} vAlign="center">
        <Icon icon={BellRing} color="success" size="sm" />
        <Text type="supporting">{t('owner.staffPushOn')}</Text>
      </HStack>
    );
  return (
    <HStack gap={2} vAlign="center" wrap="wrap">
      <Button label={t('owner.staffPush')} icon={<Icon icon={Bell} />} size="sm" isLoading={m.isPending} onClick={() => m.mutate()} />
      {failed ? <Text type="supporting">{failed}</Text> : null}
    </HStack>
  );
}
