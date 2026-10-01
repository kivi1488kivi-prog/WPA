import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@astryxdesign/core/Card';
import { DateRangeInput, type DateRangeInputProps } from '@astryxdesign/core/DateRangeInput';
import { Grid } from '@astryxdesign/core/Grid';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Section } from '@astryxdesign/core/Section';
import { Selector } from '@astryxdesign/core/Selector';
import { Table } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useTenant } from '@/app/tenant';
import { useI18n } from '@/lib/i18n';
import { fmtMoney } from '@/lib/money';
import { addDays, fmtDateShort } from '@/lib/time';
import { ErrorState, ListSkeleton } from '@/components/States';
import { can, useOwner } from '../context';
import { PageHeader } from '../ui';

type Range = NonNullable<DateRangeInputProps['value']>;

/**
 * All numbers come from SQL (owner_stats) for a period of LOCAL dates in the
 * tenant timezone — the same function the AI owner tool uses. Upcoming value is
 * labelled as expected, never as revenue; money received is payments − refunds.
 */
export function StatsPage() {
  const { intl, tz } = useTenant();
  const { t } = useI18n();
  const { api, workspace, role, tenantId } = useOwner();
  const today = workspace.today;
  const presets = useMemo(
    () => ({
      month: { from: `${today.slice(0, 8)}01`, to: addDays(`${addDays(`${today.slice(0, 8)}28`, 4).slice(0, 8)}01`, -1) },
      last30: { from: addDays(today, -29), to: today },
      next30: { from: today, to: addDays(today, 29) },
    }),
    [today],
  );
  const [preset, setPreset] = useState<'month' | 'last30' | 'next30' | 'custom'>('month');
  const [custom, setCustom] = useState<{ from: string; to: string }>(presets.month);
  const period = preset === 'custom' ? custom : presets[preset];
  const [barberId, setBarberId] = useState<string>('');
  const [serviceId, setServiceId] = useState<string>('');

  const q = useQuery({
    queryKey: ['owner', tenantId, 'stats', period.from, period.to, barberId, serviceId],
    queryFn: () => api.stats(period.from, period.to, barberId || null, serviceId || null),
  });
  const ai = useQuery({ queryKey: ['owner', tenantId, 'ai-usage'], queryFn: () => api.aiUsage(), enabled: can(role, 'manage') });
  const money = (c: number) => fmtMoney(c, workspace.tenant.currency, intl);

  return (
    <VStack gap={0}>
      <PageHeader title={t('owner.nav.stats')} subtitle={`${fmtDateShort(period.from, intl)} – ${fmtDateShort(period.to, intl)} · ${tz}`} />
      {/* filters: one row above the charts */}
      <HStack gap={2} paddingInline={4} paddingBlockEnd={3} wrap="wrap" vAlign="end">
        <Selector
          label={t('stats.period')}
          size="sm"
          width={200}
          options={[
            { value: 'month', label: t('stats.thisMonth') },
            { value: 'last30', label: t('stats.last30') },
            { value: 'next30', label: t('stats.next30') },
            { value: 'custom', label: '…' },
          ]}
          value={preset}
          onChange={(v) => setPreset(v as typeof preset)}
        />
        {preset === 'custom' ? (
          <DateRangeInput
            label={t('stats.period')}
            isLabelHidden
            size="sm"
            value={{ start: custom.from, end: custom.to } as unknown as Range}
            onChange={(r) => {
              const rr = r as unknown as { start?: string; end?: string } | null;
              if (rr?.start && rr.end) setCustom({ from: rr.start, to: rr.end });
            }}
            weekStartsOn="mon"
          />
        ) : null}
        {can(role, 'allBarbers') ? (
          <Selector
            label={t('owner.nav.barbers')}
            size="sm"
            width={180}
            options={[{ value: '', label: t('cal.allBarbers') }, ...workspace.barbers.map((b) => ({ value: b.id, label: b.name }))]}
            value={barberId}
            onChange={setBarberId}
          />
        ) : null}
        <Selector
          label={t('owner.nav.services')}
          size="sm"
          width={200}
          options={[{ value: '', label: t('stats.allServices') }, ...workspace.services.map((s) => ({ value: s.id, label: s.name }))]}
          value={serviceId}
          onChange={setServiceId}
        />
      </HStack>

      {q.isPending ? (
        <VStack padding={4}>
          <ListSkeleton rows={4} height={88} />
        </VStack>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <VStack gap={4} padding={4} paddingBlockStart={0}>
          <Grid columns={{ minWidth: 160 }} gap={3}>
            <Tile label={t('stats.upcoming')} value={String(q.data.totals.upcoming_count)} hint={t('stats.upcomingValue', { amount: money(q.data.totals.upcoming_value_cents) })} testId="kpi-upcoming" />
            <Tile label={t('stats.completed')} value={String(q.data.totals.completed_count)} hint={t('stats.completedValue', { amount: money(q.data.totals.completed_value_cents) })} testId="kpi-completed" />
            <Tile label={t('stats.cancelled')} value={String(q.data.totals.cancelled_count)} testId="kpi-cancelled" />
            <Tile label={t('stats.noShow')} value={String(q.data.totals.no_show_count)} />
            <Tile label={t('stats.received')} value={money(q.data.totals.received_cents)} hint={t('stats.refunded', { amount: money(q.data.totals.refunded_cents) })} testId="kpi-received" />
          </Grid>
          {q.data.totals.awaiting_close_count > 0 ? <Text type="supporting">{t('stats.awaiting', { n: q.data.totals.awaiting_close_count })}</Text> : null}

          <BarChart title={t('stats.daily')} rows={q.data.daily.map((d) => ({ key: d.date, label: fmtDateShort(d.date, intl), value: d.booked_count, display: String(d.booked_count) }))} />
          <BarChart title={t('stats.received')} rows={q.data.daily.map((d) => ({ key: d.date, label: fmtDateShort(d.date, intl), value: Math.max(d.received_cents, 0), display: money(d.received_cents) }))} />

          <Section padding={0}>
            <VStack gap={2}>
              <Heading level={2}>{t('stats.byBarber')}</Heading>
              <Table
                density="compact"
                data={q.data.by_barber.map((r) => ({ ...r, received: money(r.received_cents) }))}
                idKey="barber_id"
                columns={[
                  { key: 'name', header: t('booking.with') },
                  { key: 'completed_count', header: t('stats.completed'), align: 'end' },
                  { key: 'upcoming_count', header: t('stats.upcoming'), align: 'end' },
                  { key: 'cancelled_count', header: t('stats.cancelled'), align: 'end' },
                  { key: 'no_show_count', header: t('stats.noShow'), align: 'end' },
                  { key: 'received', header: t('stats.received'), align: 'end' },
                ]}
              />
            </VStack>
          </Section>
          <Section padding={0}>
            <VStack gap={2}>
              <Heading level={2}>{t('stats.byService')}</Heading>
              <Table
                density="compact"
                data={q.data.by_service.map((r) => ({ ...r, received: money(r.received_cents) }))}
                idKey="service_id"
                columns={[
                  { key: 'name', header: t('booking.service') },
                  { key: 'completed_count', header: t('stats.completed'), align: 'end' },
                  { key: 'upcoming_count', header: t('stats.upcoming'), align: 'end' },
                  { key: 'cancelled_count', header: t('stats.cancelled'), align: 'end' },
                  { key: 'received', header: t('stats.received'), align: 'end' },
                ]}
              />
            </VStack>
          </Section>
          {ai.data ? <Text type="supporting">{t('stats.aiUsage', { requests: ai.data.requests, limit: ai.data.request_limit })}</Text> : null}
        </VStack>
      )}
    </VStack>
  );
}

function Tile({ label, value, hint, testId }: { label: string; value: string; hint?: string; testId?: string }) {
  return (
    <Card padding={4} data-testid={testId}>
      <VStack gap={1}>
        <Text type="supporting">{label}</Text>
        <Text type="display-3" hasTabularNumbers>{value}</Text>
        {hint ? <Text type="supporting">{hint}</Text> : null}
      </VStack>
    </Card>
  );
}

/**
 * Single-series bar chart (one hue = accent, no legend needed; the title names
 * the series). Thin bars with 2px gaps, 4px rounded data-ends on the baseline,
 * per-bar hover/focus tooltip, recessive axis, and a table view for exact values.
 */
function BarChart({ title, rows }: { title: string; rows: { key: string; label: string; value: number; display: string }[] }) {
  const { t } = useI18n();
  const max = Math.max(1, ...rows.map((r) => r.value));
  const [hover, setHover] = useState<string | null>(null);
  const H = 120;
  const active = rows.find((r) => r.key === hover);
  return (
    <Section padding={0}>
      <VStack gap={2}>
        <HStack gap={2} className="justify-between" vAlign="center">
          <Heading level={2}>{title}</Heading>
          <Text type="supporting" aria-live="polite">{active ? `${active.label}: ${active.display}` : ''}</Text>
        </HStack>
        <div className="flex items-end gap-0.5 border-b border-border" style={{ height: H }} role="img" aria-label={`${title}: ${rows.map((r) => `${r.label} ${r.display}`).join(', ')}`}>
          {rows.map((r) => (
            <button
              key={r.key}
              type="button"
              className="group flex h-full min-w-1 flex-1 items-end"
              onMouseEnter={() => setHover(r.key)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(r.key)}
              onBlur={() => setHover(null)}
              aria-label={`${r.label}: ${r.display}`}
              title={`${r.label}: ${r.display}`}
            >
              <span
                className={`block w-full rounded-t bg-accent-bg transition-opacity ${hover && hover !== r.key ? 'opacity-50' : ''}`}
                style={{ height: r.value > 0 ? Math.max(3, (r.value / max) * (H - 4)) : 0 }}
              />
            </button>
          ))}
        </div>
        <HStack className="justify-between">
          <Text type="supporting">{rows[0]?.label}</Text>
          <Text type="supporting">{rows.at(-1)?.label}</Text>
        </HStack>
        <details className="text-sm">
          <summary className="cursor-pointer text-secondary">{t('stats.tableView')}</summary>
          <table className="mt-2 w-full text-sm">
            <tbody>
              {rows.filter((r) => r.value > 0).map((r) => (
                <tr key={r.key} className="border-b border-border">
                  <td className="py-1">{r.label}</td>
                  <td className="py-1 text-end tabular-nums">{r.display}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </VStack>
    </Section>
  );
}
