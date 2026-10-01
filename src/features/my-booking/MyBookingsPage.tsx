import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueries } from '@tanstack/react-query';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { List, ListItem } from '@astryxdesign/core/List';
import { Section } from '@astryxdesign/core/Section';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { CalendarCheck, Trash2 } from 'lucide-react';
import { useTenant } from '@/app/tenant';
import { useI18n, type MessageKey } from '@/lib/i18n';
import { publicApi } from '@/lib/api/public';
import { toApiError } from '@/lib/api/errors';
import { listSaved, removeToken } from '@/lib/tokenStore';
import { fmtDateLong } from '@/lib/time';
import { Empty, ErrorState, ListSkeleton } from '@/components/States';
import type { PublicBooking } from '@/lib/api/schemas';

const DOT = { confirmed: 'success', cancelled: 'error', completed: 'neutral', no_show: 'warning' } as const;

export function MyBookingsPage() {
  const { slug, intl } = useTenant();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [saved, setSaved] = useState(() => listSaved(slug));

  const results = useQueries({
    queries: saved.map((s) => ({
      queryKey: ['booking', slug, s.token],
      queryFn: () => publicApi.booking(slug, s.token),
      retry: (n: number, e: unknown) => n < 2 && toApiError(e).code === 'network',
    })),
  });

  const remove = (token: string) => {
    removeToken(slug, token);
    setSaved(listSaved(slug));
  };

  if (saved.length === 0) {
    return (
      <Section padding={4}>
        <VStack gap={4}>
          <Heading level={1}>{t('my.title')}</Heading>
          <Empty
            title={t('my.empty')}
            description={t('my.emptyHint')}
            icon={<Icon icon={CalendarCheck} />}
            actions={<Button label={t('shop.bookCta')} variant="primary" onClick={() => navigate(`/s/${slug}/book`)} />}
          />
        </VStack>
      </Section>
    );
  }

  const loaded: { token: string; b: PublicBooking }[] = [];
  results.forEach((r, i) => {
    if (r.data) loaded.push({ token: saved[i]!.token, b: r.data });
  });
  const now = Date.now();
  const upcoming = loaded.filter((x) => x.b.status === 'confirmed' && Date.parse(x.b.ends_at) > now).sort((a, b) => a.b.starts_at.localeCompare(b.b.starts_at));
  const past = loaded.filter((x) => !upcoming.includes(x)).sort((a, b) => b.b.starts_at.localeCompare(a.b.starts_at));
  const pending = results.some((r) => r.isPending);
  const failed = results.find((r) => r.isError && toApiError(r.error).code !== 'booking_not_found');
  const vanished = results.map((r, i) => (r.isError && toApiError(r.error).code === 'booking_not_found' ? saved[i]!.token : null)).filter(Boolean) as string[];

  const row = ({ token, b }: { token: string; b: PublicBooking }) => (
    <ListItem
      key={token}
      label={`${fmtDateLong(b.local_date, intl)}, ${b.local_time}`}
      description={`${b.service.name} · ${b.barber.name}`}
      startContent={<StatusDot variant={DOT[b.status]} label={t(`booking.status.${b.status}` as MessageKey)} />}
      endContent={
        <IconButton label={t('my.remove')} tooltip={t('my.remove')} icon={<Icon icon={Trash2} />} variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); remove(token); }} />
      }
      onClick={() => navigate(`/s/${slug}/booking#${token}`)}
    />
  );

  return (
    <Section padding={4}>
      <VStack gap={4}>
        <Heading level={1}>{t('my.title')}</Heading>
        {pending && loaded.length === 0 ? <ListSkeleton rows={Math.min(saved.length, 4)} /> : null}
        {failed ? <ErrorState error={failed.error} onRetry={() => results.forEach((r) => void r.refetch())} /> : null}
        {upcoming.length > 0 ? (
          <List header={<Heading level={2}>{t('my.upcoming')}</Heading>} hasDividers>
            {upcoming.map(row)}
          </List>
        ) : null}
        {past.length > 0 ? (
          <List header={<Heading level={2}>{t('my.past')}</Heading>} hasDividers>
            {past.map(row)}
          </List>
        ) : null}
        {vanished.length > 0
          ? vanished.map((tok) => (
              <Text key={tok} type="supporting">
                {t('booking.notFound')} ·{' '}
                <button type="button" className="text-accent underline" onClick={() => remove(tok)}>{t('my.remove')}</button>
              </Text>
            ))
          : null}
      </VStack>
    </Section>
  );
}
