import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Button } from '@astryxdesign/core/Button';
import { Carousel } from '@astryxdesign/core/Carousel';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon } from '@astryxdesign/core/Icon';
import { Lightbox } from '@astryxdesign/core/Lightbox';
import { List, ListItem } from '@astryxdesign/core/List';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Section } from '@astryxdesign/core/Section';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Text } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
import { VStack } from '@astryxdesign/core/VStack';
import { AtSign, Clock, Globe, MapPin, Phone, Scissors } from 'lucide-react';
import { useTenant } from '@/app/tenant';
import { useI18n } from '@/lib/i18n';
import { mediaUrl } from '@/lib/media';
import { fmtMoney } from '@/lib/money';
import { formatDayHours, openState, weekdayName } from '@/lib/hours';
import { Sheet } from '@/components/Sheet';
import { Empty } from '@/components/States';
import type { PublicBarber } from '@/lib/api/schemas';

export function ShopPage() {
  const { slug, shop, tz, intl } = useTenant();
  const { t } = useI18n();
  const navigate = useNavigate();
  const { tenant } = shop;
  const [barberSheet, setBarberSheet] = useState<PublicBarber | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const cover = mediaUrl(shop.photos.find((p) => p.kind === 'cover')?.path ?? tenant.cover_path);
  const gallery = shop.photos.filter((p) => p.kind !== 'cover');
  const state = useMemo(() => openState(shop.opening_hours, tz), [shop.opening_hours, tz]);
  const servicesById = useMemo(() => new Map(shop.services.map((s) => [s.id, s])), [shop.services]);

  const statusLabel =
    state.kind === 'open'
      ? t('shop.openNow', { time: state.until })
      : state.opensAt && state.nextWeekday
        ? t('shop.opensAt', { day: weekdayName(state.nextWeekday, intl), time: state.opensAt })
        : t('shop.closedNow');

  const book = (params: Record<string, string> = {}) => navigate({ pathname: `/s/${slug}/book`, search: new URLSearchParams(params).toString() });
  const address = [tenant.address_line, tenant.postal_code, tenant.city].filter(Boolean).join(', ');
  const mapHref = tenant.map_url ?? (address ? `https://maps.google.com/?q=${encodeURIComponent(address)}` : null);

  return (
    <VStack gap={0}>
      {/* Hero: interior photo, name, live open state and the primary action. */}
      <header className="relative isolate overflow-hidden">
        {cover ? (
          <img src={cover} alt="" className="absolute inset-0 -z-10 h-full w-full object-cover" fetchPriority="high" />
        ) : null}
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-body/10 via-body/60 to-body" aria-hidden />
        <VStack gap={3} paddingInline={4} paddingBlockStart={10} paddingBlockEnd={5} className="min-h-[46dvh] justify-end">
          {tenant.logo_path ? (
            <img src={mediaUrl(tenant.logo_path) ?? ''} alt="" className="size-14 rounded-xl border border-border object-cover" />
          ) : null}
          <VStack gap={1}>
            <Heading level={1} type="display-3">{tenant.name}</Heading>
            {tenant.tagline ? <Text color="secondary">{tenant.tagline}</Text> : null}
          </VStack>
          <HStack gap={2} vAlign="center">
            <StatusDot variant={state.kind === 'open' ? 'success' : 'neutral'} label={statusLabel} />
            <Text type="supporting">{statusLabel}</Text>
          </HStack>
          <Button label={t('shop.bookCta')} variant="primary" size="lg" width="100%" onClick={() => book()} data-testid="hero-book" />
        </VStack>
      </header>

      {/* Quick contacts */}
      <HStack gap={2} paddingInline={4} paddingBlockEnd={2} wrap="wrap">
        {mapHref ? <Button label={t('shop.openMap')} icon={<Icon icon={MapPin} />} href={mapHref} target="_blank" rel="noopener noreferrer" size="sm" /> : null}
        {tenant.phone ? <Button label={t('shop.call')} icon={<Icon icon={Phone} />} href={`tel:${tenant.phone.replace(/\s/g, '')}`} size="sm" /> : null}
      </HStack>

      {gallery.length > 0 ? (
        <Section padding={4} aria-labelledby="photos-h">
          <VStack gap={3}>
            <Heading level={2} id="photos-h">{t('shop.photos')}</Heading>
            <Carousel gap={2} aria-label={t('shop.photos')} hasSnap>
              {gallery.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setLightboxIndex(i)}
                  className="block h-44 w-64 shrink-0 overflow-hidden rounded-xl border border-border"
                  aria-label={t('shop.photoOpen', { n: i + 1, total: gallery.length })}
                >
                  <img src={mediaUrl(p.path) ?? ''} alt={p.alt} loading="lazy" className="h-full w-full object-cover" />
                </button>
              ))}
            </Carousel>
          </VStack>
        </Section>
      ) : null}

      <Section padding={4} aria-labelledby="services-h">
        <VStack gap={2}>
          <Heading level={2} id="services-h">{t('shop.services')}</Heading>
          {shop.services.length === 0 ? (
            <Empty title={t('shop.noServices')} icon={<Icon icon={Scissors} />} />
          ) : (
            <List hasDividers density="spacious">
              {shop.services.map((s) => (
                <ListItem
                  key={s.id}
                  label={s.name}
                  description={[t('app.minutes', { n: s.duration_min }), s.description].filter(Boolean).join(' · ')}
                  endContent={<Text weight="semibold" hasTabularNumbers>{fmtMoney(s.price_cents, tenant.currency, intl)}</Text>}
                  onClick={() => book({ service: s.id })}
                />
              ))}
            </List>
          )}
        </VStack>
      </Section>

      {shop.barbers.length > 0 ? (
        <Section padding={4} aria-labelledby="team-h">
          <VStack gap={3}>
            <Heading level={2} id="team-h">{t('shop.team')}</Heading>
            <Carousel gap={3} aria-label={t('shop.team')} hasSnap>
              {shop.barbers.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setBarberSheet(b)}
                  className="flex w-36 shrink-0 flex-col items-center gap-2 rounded-xl border border-border bg-surface p-3 text-center"
                  data-testid={`barber-card-${b.id}`}
                >
                  <Avatar src={mediaUrl(b.photo_path) ?? undefined} name={b.name} size={72} tooltip={false} />
                  <Text weight="semibold" maxLines={1}>{b.name}</Text>
                  {b.title ? <Text type="supporting" maxLines={1}>{b.title}</Text> : null}
                  <HStack gap={1} vAlign="center">
                    <StatusDot variant={b.works_today ? 'success' : 'neutral'} label={b.works_today ? t('shop.worksToday') : t('shop.offToday')} />
                    <Text type="supporting">{b.works_today ? t('shop.worksToday') : t('shop.offToday')}</Text>
                  </HStack>
                </button>
              ))}
            </Carousel>
          </VStack>
        </Section>
      ) : null}

      <Section padding={4} aria-labelledby="contacts-h">
        <VStack gap={3}>
          <Heading level={2} id="contacts-h">{t('shop.contacts')}</Heading>
          <MetadataList>
            {address ? (
              <MetadataListItem label={t('shop.address')} icon={<Icon icon={MapPin} size="sm" />}>
                {mapHref ? <a className="text-accent underline-offset-2 hover:underline" href={mapHref} target="_blank" rel="noopener noreferrer">{address}</a> : address}
              </MetadataListItem>
            ) : null}
            {tenant.phone ? (
              <MetadataListItem label={t('shop.phone')} icon={<Icon icon={Phone} size="sm" />}>
                <a className="text-accent" href={`tel:${tenant.phone.replace(/\s/g, '')}`}>{tenant.phone}</a>
              </MetadataListItem>
            ) : null}
            {tenant.instagram ? (
              <MetadataListItem label="Instagram" icon={<Icon icon={AtSign} size="sm" />}>
                <a className="text-accent" href={`https://instagram.com/${tenant.instagram.replace(/^@/, '')}`} target="_blank" rel="noopener noreferrer">{tenant.instagram}</a>
              </MetadataListItem>
            ) : null}
            {tenant.website ? (
              <MetadataListItem label="Web" icon={<Icon icon={Globe} size="sm" />}>
                <a className="text-accent" href={tenant.website} target="_blank" rel="noopener noreferrer">{tenant.website.replace(/^https?:\/\//, '')}</a>
              </MetadataListItem>
            ) : null}
          </MetadataList>
          <MetadataList title={<HStack gap={1} vAlign="center"><Icon icon={Clock} size="sm" /><Text weight="semibold">{t('shop.hours')}</Text></HStack>}>
            {[1, 2, 3, 4, 5, 6, 7].map((wd) => (
              <MetadataListItem key={wd} label={weekdayName(wd, intl)}>
                <Text hasTabularNumbers color={formatDayHours(shop.opening_hours, wd) ? 'primary' : 'secondary'}>
                  {formatDayHours(shop.opening_hours, wd) ?? t('shop.closed')}
                </Text>
              </MetadataListItem>
            ))}
          </MetadataList>
          {tenant.description ? <Text color="secondary">{tenant.description}</Text> : null}
          <Text type="supporting">{t('app.tzNote', { tz })}</Text>
        </VStack>
      </Section>

      <Sheet
        open={barberSheet !== null}
        onOpenChange={(o) => !o && setBarberSheet(null)}
        title={barberSheet?.name ?? ''}
        description={barberSheet?.title ?? undefined}
        headerStart={barberSheet ? <Avatar src={mediaUrl(barberSheet.photo_path) ?? undefined} name={barberSheet.name} size="lg" tooltip={false} /> : null}
        footer={
          barberSheet ? (
            <Button
              label={t('shop.bookWith', { name: barberSheet.name })}
              variant="primary"
              size="lg"
              width="100%"
              onClick={() => book({ barber: barberSheet.id })}
            />
          ) : null
        }
        testId="barber-sheet"
      >
        {barberSheet ? (
          <VStack gap={3}>
            {barberSheet.bio ? <Text>{barberSheet.bio}</Text> : null}
            {barberSheet.specialties.length > 0 ? (
              <HStack gap={1} wrap="wrap">
                {barberSheet.specialties.map((s) => (
                  <Token key={s} label={s} size="sm" />
                ))}
              </HStack>
            ) : null}
            <Heading level={3}>{t('shop.barberServices')}</Heading>
            <List hasDividers>
              {barberSheet.service_ids
                .map((id) => servicesById.get(id))
                .filter((s) => s !== undefined)
                .map((s) => (
                  <ListItem
                    key={s.id}
                    label={s.name}
                    description={t('app.minutes', { n: s.duration_min })}
                    endContent={<Text hasTabularNumbers>{fmtMoney(s.price_cents, tenant.currency, intl)}</Text>}
                    onClick={() => book({ service: s.id, barber: barberSheet.id })}
                  />
                ))}
            </List>
          </VStack>
        ) : null}
      </Sheet>

      {gallery.length > 0 ? (
        <Lightbox
          isOpen={lightboxIndex !== null}
          onOpenChange={(o) => !o && setLightboxIndex(null)}
          media={gallery.map((p) => ({ src: mediaUrl(p.path) ?? '', alt: p.alt }))}
          index={lightboxIndex ?? 0}
          onIndexChange={setLightboxIndex}
        />
      ) : null}
    </VStack>
  );
}
