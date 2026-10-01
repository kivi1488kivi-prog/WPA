import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueries } from '@tanstack/react-query';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { Icon } from '@astryxdesign/core/Icon';
import { Selector } from '@astryxdesign/core/Selector';
import { VStack } from '@astryxdesign/core/VStack';
import { Bot } from 'lucide-react';
import { useTenant } from '@/app/tenant';
import { useI18n } from '@/lib/i18n';
import { env } from '@/lib/env';
import { publicApi } from '@/lib/api/public';
import { listSaved } from '@/lib/tokenStore';
import { fmtDateLong } from '@/lib/time';
import { ChatPanel } from './ChatPanel';

export default function AssistantPage() {
  const { slug, intl } = useTenant();
  const { t } = useI18n();
  const navigate = useNavigate();
  const saved = useMemo(() => listSaved(slug), [slug]);
  const bookings = useQueries({ queries: saved.map((s) => ({ queryKey: ['booking', slug, s.token], queryFn: () => publicApi.booking(slug, s.token) })) });
  const active = bookings
    .map((q, i) => ({ q, token: saved[i]!.token }))
    .filter(({ q }) => q.data?.status === 'confirmed' && Date.parse(q.data.starts_at) > Date.now());
  const [token, setToken] = useState<string>('');

  const unavailable = (
    <EmptyState
      title={t('ai.unavailable')}
      description={t('ai.unavailableHint')}
      icon={<Icon icon={Bot} size="lg" />}
      actions={<Button label={t('shop.bookCta')} variant="primary" onClick={() => navigate(`/s/${slug}/book`)} />}
    />
  );

  return (
    <VStack gap={3} padding={4} className="h-[calc(100dvh-7rem)] min-h-0">
      <Heading level={1}>{t('ai.title')}</Heading>
      {active.length > 0 ? (
        <Selector
          label={t('ai.forBooking')}
          options={[{ value: '', label: t('ai.noBooking') }, ...active.map(({ q, token: tk }) => ({ value: tk, label: `${fmtDateLong(q.data!.local_date, intl)}, ${q.data!.local_time} · ${q.data!.service.name}` }))]}
          value={token}
          onChange={setToken}
          width="100%"
          size="sm"
        />
      ) : null}
      <ChatPanel
        slug={slug}
        scope="client"
        authToken={async () => env.supabaseAnonKey}
        bookingToken={token || null}
        suggestions={['ai.suggest.services', 'ai.suggest.today', 'ai.suggest.when', 'ai.suggest.tomorrow']}
        onUnavailable={unavailable}
      />
    </VStack>
  );
}
