import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Icon } from '@astryxdesign/core/Icon';
import { VStack } from '@astryxdesign/core/VStack';
import { Bot } from 'lucide-react';
import { useTenant } from '@/app/tenant';
import { useI18n } from '@/lib/i18n';
import { getSupabase } from '@/lib/supabase';
import { ChatPanel } from '@/features/assistant/ChatPanel';
import { PageHeader } from './ui';

/** Staff assistant: owner-scope tools run with the signed-in user's JWT (read-only). */
export function OwnerAssistant() {
  const { slug } = useTenant();
  const { t } = useI18n();
  return (
    <VStack gap={0} className="h-[calc(100dvh-8rem)] min-h-0">
      <PageHeader title={t('ai.title')} />
      <VStack padding={4} paddingBlockStart={0} className="min-h-0 flex-1">
        <ChatPanel
          slug={slug}
          scope="owner"
          authToken={async () => (await getSupabase(slug).auth.getSession()).data.session?.access_token ?? ''}
          suggestions={['ai.suggest.today', 'ai.suggest.tomorrow']}
          onUnavailable={<EmptyState title={t('ai.unavailable')} description={t('ai.unavailableHint')} icon={<Icon icon={Bot} size="lg" />} />}
        />
      </VStack>
    </VStack>
  );
}
