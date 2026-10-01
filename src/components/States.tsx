import type { ReactNode } from 'react';
import { Spinner } from '@astryxdesign/core/Spinner';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Button } from '@astryxdesign/core/Button';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { VStack } from '@astryxdesign/core/VStack';
import { Center } from '@astryxdesign/core/Center';
import { CircleAlert, WifiOff } from 'lucide-react';
import { Icon } from '@astryxdesign/core/Icon';
import { toApiError } from '@/lib/api/errors';
import { useI18n, type MessageKey } from '@/lib/i18n';

export function FullscreenSpinner({ label }: { label?: string }) {
  return (
    <Center axis="both" minHeight="60dvh">
      <VStack gap={2} align="center" paddingBlock={10}>
        <Spinner size="lg" aria-label={label ?? 'Loading'} />
      </VStack>
    </Center>
  );
}

export function errorText(t: ReturnType<typeof useI18n>['t'], err: unknown): string {
  const e = toApiError(err);
  if (e.code === 'not_ready') return t('err.not_ready', { detail: e.detail });
  const key = `err.${e.code}` as MessageKey;
  const msg = t(key);
  return msg === key ? t('err.unknown') : msg;
}

export function ErrorState({ error, onRetry, title }: { error: unknown; onRetry?: () => void; title?: string }) {
  const { t } = useI18n();
  const isNetwork = toApiError(error).code === 'network';
  return (
    <EmptyState
      title={title ?? t('app.error.title')}
      description={errorText(t, error)}
      icon={<Icon icon={isNetwork ? WifiOff : CircleAlert} size="lg" />}
      actions={onRetry ? <Button label={t('app.retry')} onClick={onRetry} /> : undefined}
    />
  );
}

export function Empty({ title, description, icon, actions }: { title: string; description?: string; icon?: ReactNode; actions?: ReactNode }) {
  return <EmptyState title={title} description={description} icon={icon} actions={actions} isCompact />;
}

export function ListSkeleton({ rows = 4, height = 56 }: { rows?: number; height?: number }) {
  return (
    <VStack gap={2} aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} index={i} height={height} />
      ))}
    </VStack>
  );
}
