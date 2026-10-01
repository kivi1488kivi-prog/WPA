import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon } from '@astryxdesign/core/Icon';
import { List, ListItem } from '@astryxdesign/core/List';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Section } from '@astryxdesign/core/Section';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useToast } from '@astryxdesign/core/Toast';
import { VStack } from '@astryxdesign/core/VStack';
import { ArrowLeft, Download, Search, UserX, Users } from 'lucide-react';
import { useTenant } from '@/app/tenant';
import { useI18n, type MessageKey } from '@/lib/i18n';
import { fmtMoney } from '@/lib/money';
import { dateInTz, fmtDateLong, fmtDateTime } from '@/lib/time';
import { Empty, ErrorState, ListSkeleton, errorText } from '@/components/States';
import { can, useOwner } from '../context';
import { PageHeader } from '../ui';

function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const id = setTimeout(() => setD(v), ms);
    return () => clearTimeout(id);
  }, [v, ms]);
  return d;
}

export function ClientsPage() {
  const { customerId } = useParams();
  return customerId ? <ClientCard id={customerId} /> : <ClientList />;
}

function ClientList() {
  const { tz, intl } = useTenant();
  const { t } = useI18n();
  const { api, tenantId, base } = useOwner();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const list = useQuery({ queryKey: ['owner', tenantId, 'customers', q], queryFn: () => api.customers(q) });
  return (
    <VStack gap={0}>
      <PageHeader title={t('owner.nav.clients')} />
      <VStack paddingInline={4} paddingBlockEnd={3}>
        <TextInput label={t('clients.search')} isLabelHidden placeholder={t('clients.search')} value={search} onChange={setSearch} startIcon={Search} hasClear width="100%" />
      </VStack>
      <Section padding={4} paddingBlockStart={0}>
        {list.isPending ? (
          <ListSkeleton rows={6} />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : list.data.length === 0 ? (
          <Empty title={t('clients.empty')} icon={<Icon icon={Users} />} />
        ) : (
          <List hasDividers>
            {list.data.map((c) => (
              <ListItem
                key={c.id}
                label={c.name}
                description={[
                  c.phone,
                  t('clients.visits', { n: c.visits }),
                  c.no_shows ? t('clients.noShows', { n: c.no_shows }) : null,
                  c.next_visit ? t('clients.next', { date: fmtDateLong(dateInTz(c.next_visit, tz), intl) }) : c.last_visit ? t('clients.last', { date: fmtDateLong(dateInTz(c.last_visit, tz), intl) }) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                endContent={c.is_demo ? <Badge label={t('cal.demo')} /> : undefined}
                onClick={() => navigate(`${base}/clients/${c.id}`)}
              />
            ))}
          </List>
        )}
      </Section>
    </VStack>
  );
}

function ClientCard({ id }: { id: string }) {
  const { tz, intl } = useTenant();
  const { t } = useI18n();
  const { api, role, tenantId, base } = useOwner();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const card = useQuery({ queryKey: ['owner', tenantId, 'customer', id], queryFn: () => api.customer(id) });
  const [note, setNote] = useState<string | null>(null);
  const [confirmErase, setConfirmErase] = useState(false);
  const save = useMutation({
    mutationFn: () => api.updateCustomer(id, { internal_note: note ?? '' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['owner', tenantId] });
      showToast({ body: t('app.saved') });
    },
    onError: (e) => showToast({ body: errorText(t, e), type: 'error' }),
  });
  const erase = useMutation({
    mutationFn: () => api.anonymizeCustomer(id),
    onSuccess: () => {
      setConfirmErase(false);
      void queryClient.invalidateQueries({ queryKey: ['owner', tenantId] });
      showToast({ body: t('clients.anonymized') });
    },
    onError: (e) => {
      setConfirmErase(false);
      showToast({ body: errorText(t, e), type: 'error' });
    },
  });
  const exportData = async () => {
    try {
      const data = await api.exportCustomer(id);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `client-${id.slice(0, 8)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      showToast({ body: errorText(t, e), type: 'error' });
    }
  };

  if (card.isPending) return <VStack padding={4}><ListSkeleton rows={5} /></VStack>;
  if (card.isError) return <ErrorState error={card.error} onRetry={() => void card.refetch()} />;
  const c = card.data.customer;
  const value = note ?? c.internal_note;
  const anonymized = !!c.anonymized_at;
  return (
    <VStack gap={0}>
      <PageHeader
        title={c.name}
        subtitle={anonymized ? t('clients.anonymizedBadge') : c.phone}
        actions={<Button label={t('app.back')} icon={<Icon icon={ArrowLeft} />} variant="ghost" onClick={() => navigate(`${base}/clients`)} />}
      />
      <Section padding={4}>
        <VStack gap={4}>
          <MetadataList>
            <MetadataListItem label={t('book.phone')}>{anonymized ? '—' : <a className="text-accent" href={`tel:${c.phone.replace(/\s/g, '')}`}>{c.phone}</a>}</MetadataListItem>
            {c.email ? <MetadataListItem label={t('book.email')}><a className="text-accent" href={`mailto:${c.email}`}>{c.email}</a></MetadataListItem> : null}
            <MetadataListItem label={t('clients.visitsLabel')}>
              {card.data.history.filter((h) => h.status === 'completed').length}
            </MetadataListItem>
          </MetadataList>
          {!anonymized ? (
            <VStack gap={2}>
              <TextArea label={t('clients.notes')} value={value} onChange={setNote} rows={3} width="100%" isReadOnly={!can(role, 'manage')} />
              {can(role, 'manage') ? <Button label={t('app.save')} size="sm" isDisabled={note === null || note === c.internal_note} isLoading={save.isPending} onClick={() => save.mutate()} /> : null}
            </VStack>
          ) : null}
          <VStack gap={2}>
            <Heading level={2}>{t('clients.history')}</Heading>
            {card.data.history.length === 0 ? (
              <Text color="secondary">{t('cal.empty')}</Text>
            ) : (
              <List hasDividers density="compact">
                {card.data.history.map((h) => (
                  <ListItem
                    key={h.id}
                    label={`${fmtDateTime(h.starts_at, tz, intl)} · ${h.service_name}`}
                    description={`${h.barber_name} · ${t(`cal.kind.${h.status}` as MessageKey)} · ${fmtMoney(h.price_cents, h.currency, intl)}${h.paid_cents !== null ? ` · ${t('bk.paid')} ${fmtMoney(h.paid_cents, h.currency, intl)}` : ''}`}
                  />
                ))}
              </List>
            )}
          </VStack>
          <HStack gap={2} wrap="wrap">
            {can(role, 'gdprExport') ? <Button label={t('clients.export')} icon={<Icon icon={Download} />} onClick={() => void exportData()} /> : null}
            {can(role, 'gdprErase') && !anonymized ? (
              <Button label={t('clients.anonymize')} icon={<Icon icon={UserX} />} variant="destructive" onClick={() => setConfirmErase(true)} />
            ) : null}
          </HStack>
        </VStack>
      </Section>
      <AlertDialog
        isOpen={confirmErase}
        onOpenChange={setConfirmErase}
        title={t('clients.anonymizeTitle')}
        description={t('clients.anonymizeBody')}
        actionLabel={t('clients.anonymize')}
        cancelLabel={t('app.cancel')}
        isActionLoading={erase.isPending}
        onAction={() => erase.mutate()}
      />
    </VStack>
  );
}
