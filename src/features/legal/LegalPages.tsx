import type { ReactNode } from 'react';
import { Heading } from '@astryxdesign/core/Heading';
import { Section } from '@astryxdesign/core/Section';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useTenant } from '@/app/tenant';
import { useI18n } from '@/lib/i18n';
import type { Legal } from '@/lib/api/schemas';

/*
 * Legal pages generated from the tenant's structured legal data
 * (business.json `legal` -> tenants.legal). German text is used for German
 * and Russian tenants (German law applies); English for English tenants.
 * These are carefully drafted templates, not legal advice: each operator must
 * have them reviewed before going live (see SETUP.md / ACCEPTANCE.md).
 */

type Lang = 'de' | 'en';

function P({ children }: { children: ReactNode }) {
  return (
    <Text as="p" display="block">
      {children}
    </Text>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <VStack gap={2}>
      <Heading level={2}>{title}</Heading>
      {children}
    </VStack>
  );
}

function lines(...xs: (string | undefined | null | false)[]) {
  return xs.filter(Boolean).map((x, i) => (
    <Text key={i} display="block">
      {x}
    </Text>
  ));
}

function useLegal(): { legal: Legal; lang: Lang; name: string; aiEnabled: boolean; retention: number } {
  const { shop } = useTenant();
  return {
    legal: shop.tenant.legal,
    lang: shop.tenant.locale === 'en' ? 'en' : 'de',
    name: shop.tenant.name,
    aiEnabled: shop.tenant.ai_enabled,
    retention: shop.tenant.retention_months,
  };
}

export function ImpressumPage() {
  const { legal, lang, name } = useLegal();
  const { t } = useI18n();
  const im = legal.impressum ?? {};
  const de = lang === 'de';
  const dispute = {
    not_willing: de
      ? 'Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.'
      : 'We are neither willing nor obliged to participate in dispute resolution proceedings before a consumer arbitration board.',
    willing: de
      ? 'Wir sind bereit, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen (Universalschlichtungsstelle des Bundes).'
      : 'We are willing to participate in dispute resolution proceedings before a consumer arbitration board.',
    obliged: de
      ? 'Wir sind verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.'
      : 'We are obliged to participate in dispute resolution proceedings before a consumer arbitration board.',
  }[im.dispute_resolution ?? 'not_willing'];

  return (
    <Section padding={4}>
      <VStack gap={5}>
        <Heading level={1}>{t('legal.impressum')}</Heading>
        <Block title={de ? 'Angaben gemäß § 5 DDG' : 'Information pursuant to § 5 DDG (German Digital Services Act)'}>
          {lines(im.legal_name ?? name, im.legal_form, im.street, [im.postal_code, im.city].filter(Boolean).join(' '), im.country)}
          {im.represented_by ? <P>{(de ? 'Vertreten durch: ' : 'Represented by: ') + im.represented_by}</P> : null}
        </Block>
        <Block title={de ? 'Kontakt' : 'Contact'}>
          {im.phone ? <Text display="block">{(de ? 'Telefon: ' : 'Phone: ')}<a className="text-accent" href={`tel:${im.phone.replace(/\s/g, '')}`}>{im.phone}</a></Text> : null}
          {im.email ? <Text display="block">E-Mail: <a className="text-accent" href={`mailto:${im.email}`}>{im.email}</a></Text> : null}
        </Block>
        {im.register ? (
          <Block title={de ? 'Registereintrag' : 'Register entry'}>
            {lines(`${de ? 'Registergericht' : 'Register court'}: ${im.register.court}`, `${de ? 'Registernummer' : 'Register number'}: ${im.register.number}`)}
          </Block>
        ) : null}
        {im.vat_id || im.tax_number ? (
          <Block title={de ? 'Umsatzsteuer' : 'VAT'}>
            {lines(
              im.vat_id && (de ? `Umsatzsteuer-Identifikationsnummer gemäß § 27a UStG: ${im.vat_id}` : `VAT ID pursuant to § 27a UStG: ${im.vat_id}`),
              im.tax_number && (de ? `Steuernummer: ${im.tax_number}` : `Tax number: ${im.tax_number}`),
            )}
          </Block>
        ) : null}
        {im.profession ? (
          <Block title={de ? 'Berufsbezeichnung und berufsrechtliche Regelungen' : 'Professional title and regulations'}>
            {lines(
              `${de ? 'Berufsbezeichnung' : 'Professional title'}: ${im.profession.title}${im.profession.awarded_in ? ` (${de ? 'verliehen in' : 'awarded in'} ${im.profession.awarded_in})` : ''}`,
              `${de ? 'Zuständige Kammer' : 'Competent chamber'}: ${im.profession.chamber}`,
            )}
            {im.profession.rules ? (
              <Text display="block">
                {de ? 'Es gelten folgende berufsrechtliche Regelungen: ' : 'Applicable regulations: '}
                {im.profession.rules_url ? (
                  <a className="text-accent" href={im.profession.rules_url} target="_blank" rel="noopener noreferrer">{im.profession.rules}</a>
                ) : (
                  im.profession.rules
                )}
              </Text>
            ) : null}
          </Block>
        ) : null}
        {im.content_responsible ? (
          <Block title={de ? 'Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV' : 'Responsible for content (§ 18(2) MStV)'}>
            {lines(im.content_responsible.name, im.content_responsible.address)}
          </Block>
        ) : null}
        <Block title={de ? 'Verbraucherstreitbeilegung' : 'Consumer dispute resolution'}>
          <P>{dispute}</P>
        </Block>
        <Text type="supporting">{t('legal.notLegalAdvice')}</Text>
      </VStack>
    </Section>
  );
}

export function PrivacyPage() {
  const { legal, lang, name, aiEnabled, retention } = useLegal();
  const { t } = useI18n();
  const im = legal.impressum ?? {};
  const pr = legal.privacy ?? {};
  const de = lang === 'de';
  const processors = [
    {
      name: pr.hosting ?? 'Supabase (EU) · Cloudflare Pages',
      purpose: de ? 'Hosting, Datenbank, Dateispeicher, Anmeldung für Mitarbeitende' : 'Hosting, database, file storage, staff sign-in',
      location: de ? 'siehe Anbieter' : 'see provider',
    },
    ...(aiEnabled
      ? [{ name: pr.ai_provider ?? (de ? 'KI-Anbieter' : 'AI provider'), purpose: de ? 'Beantwortung von Fragen im Assistenten' : 'Answering questions in the assistant', location: de ? 'siehe Anbieter' : 'see provider' }]
      : []),
    {
      name: de ? 'Push-Dienst Ihres Browsers (z. B. Google, Apple, Mozilla)' : "Your browser's push service (e.g. Google, Apple, Mozilla)",
      purpose: de ? 'Zustellung von Erinnerungen, nur nach Einwilligung' : 'Delivering reminders, only after consent',
      location: de ? 'ggf. Drittland' : 'possibly third country',
    },
    ...(pr.extra_processors ?? []),
  ];

  return (
    <Section padding={4}>
      <VStack gap={5}>
        <Heading level={1}>{de ? 'Datenschutzerklärung' : 'Privacy policy'}</Heading>

        <Block title={de ? 'Verantwortlicher' : 'Controller'}>
          {lines(im.legal_name ?? name, im.street, [im.postal_code, im.city].filter(Boolean).join(' '), im.country, im.email && `E-Mail: ${im.email}`, im.phone && `${de ? 'Telefon' : 'Phone'}: ${im.phone}`)}
          {pr.dpo ? <P>{(de ? 'Datenschutzbeauftragte/r: ' : 'Data protection officer: ') + `${pr.dpo.name}, ${pr.dpo.email}`}</P> : null}
        </Block>

        <Block title={de ? 'Online-Terminbuchung' : 'Online booking'}>
          <P>
            {de
              ? 'Wenn Sie einen Termin buchen, verarbeiten wir Ihren Namen, Ihre Telefonnummer, optional Ihre E-Mail-Adresse sowie die Termindaten (Leistung, Barber, Datum, Uhrzeit, Preis). Zweck ist die Vereinbarung, Durchführung und Verwaltung Ihres Termins. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO (Vertrag bzw. vorvertragliche Maßnahmen). Name und Telefonnummer sind für die Buchung erforderlich; ohne sie ist keine Online-Buchung möglich.'
              : 'When you book an appointment we process your name, phone number, optionally your email address and the appointment details (service, barber, date, time, price) to arrange, perform and manage the appointment. Legal basis: Art. 6(1)(b) GDPR. Name and phone number are required for booking.'}
          </P>
          <P>
            {de
              ? 'Den Zugriff auf Ihren Termin erhalten Sie über einen persönlichen Link. Wir speichern davon nur einen kryptografischen Hashwert, nicht den Link selbst.'
              : 'You access your booking through a personal link. We store only a cryptographic hash of it, never the link itself.'}
          </P>
        </Block>

        <Block title={de ? 'Erinnerungen per Push-Benachrichtigung' : 'Push reminders'}>
          <P>
            {de
              ? 'Nur wenn Sie aktiv „Erinnerungen erhalten“ wählen und im Browser zustimmen, speichern wir die technische Push-Adresse Ihres Geräts und senden Erinnerungen bzw. Änderungsmitteilungen zu Ihrem Termin über den Push-Dienst Ihres Browserherstellers. Rechtsgrundlage ist Ihre Einwilligung (Art. 6 Abs. 1 lit. a DSGVO, § 25 Abs. 1 TDDDG). Sie können sie jederzeit in den Browser-Einstellungen widerrufen.'
              : 'Only if you choose "Get reminders" and allow notifications do we store your device\'s push address and send reminders via your browser vendor\'s push service. Legal basis: your consent (Art. 6(1)(a) GDPR, § 25(1) TDDDG). You can withdraw it at any time in your browser settings.'}
          </P>
        </Block>

        {aiEnabled ? (
          <Block title={de ? 'KI-Assistent' : 'AI assistant'}>
            <P>
              {de
                ? 'Der Assistent ist ein KI-System. Ihre Nachrichten werden zur Erzeugung einer Antwort an den unten genannten KI-Anbieter übermittelt. Angaben zu Terminen und freien Zeiten werden vorher aus unserem Buchungssystem abgefragt. Wir speichern die Chatverläufe nicht dauerhaft. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO bzw. unser berechtigtes Interesse an einer schnellen Beantwortung von Anfragen (Art. 6 Abs. 1 lit. f DSGVO). Bitte geben Sie keine sensiblen Daten ein. Die Nutzung ist freiwillig.'
                : 'The assistant is an AI system. Your messages are sent to the AI provider listed below to generate an answer; schedule information is first looked up in our booking system. We do not store chat transcripts permanently. Legal basis: Art. 6(1)(b) or (f) GDPR. Please do not enter sensitive data. Use is optional.'}
            </P>
          </Block>
        ) : null}

        <Block title={de ? 'Technisch notwendige Daten' : 'Technically necessary data'}>
          <P>
            {de
              ? 'Zum Schutz vor Missbrauch (z. B. massenhafte Buchungsversuche) verarbeiten wir Ihre IP-Adresse kurzfristig in Zählern zur Begrenzung von Anfragen; diese werden nach spätestens 2 Tagen gelöscht (Art. 6 Abs. 1 lit. f DSGVO). Im Speicher Ihres Browsers (localStorage) legen wir nur ab, was für die Funktion nötig ist oder was Sie selbst eingegeben haben: Links zu Ihren Terminen und Ihre Kontaktdaten zum Vorausfüllen (§ 25 Abs. 2 Nr. 2 TDDDG). Wir verwenden keine Tracking-Cookies und keine Analyse- oder Werbedienste.'
              : 'To prevent abuse we briefly process your IP address in rate-limit counters, deleted after at most 2 days (Art. 6(1)(f) GDPR). Your browser storage only keeps what the app needs or what you entered: links to your bookings and contact details for prefilling. We use no tracking cookies, analytics or advertising.'}
          </P>
        </Block>

        <Block title={de ? 'Empfänger und Auftragsverarbeiter' : 'Recipients and processors'}>
          <P>
            {de
              ? 'Wir setzen folgende Dienstleister ein, mit denen – soweit erforderlich – Verträge zur Auftragsverarbeitung nach Art. 28 DSGVO bestehen. Bei Übermittlungen in Drittländer stützen wir uns auf Angemessenheitsbeschlüsse (z. B. EU-US Data Privacy Framework) oder Standardvertragsklauseln.'
              : 'We use the following providers under data processing agreements (Art. 28 GDPR) where required. Transfers to third countries rely on adequacy decisions or standard contractual clauses.'}
          </P>
          <ul className="list-disc ps-5">
            {processors.map((p) => (
              <li key={p.name}>
                <Text>
                  <Text weight="semibold">{p.name}</Text> — {p.purpose} ({p.location})
                </Text>
              </li>
            ))}
          </ul>
        </Block>

        <Block title={de ? 'Speicherdauer' : 'Retention'}>
          <P>
            {de
              ? `Personenbezogene Kundendaten (Name, Telefon, E-Mail, Notizen) werden automatisch anonymisiert, wenn seit ${retention} Monaten kein Termin mehr stattgefunden hat, oder früher auf Ihren Wunsch. Termin- und Zahlungsdaten ohne Personenbezug bewahren wir im Rahmen gesetzlicher Aufbewahrungspflichten (§ 147 AO, § 257 HGB) auf.`
              : `Personal client data (name, phone, email, notes) is anonymized automatically after ${retention} months without an appointment, or earlier on request. Appointment and payment facts without personal identifiers are kept for statutory retention periods.`}
          </P>
        </Block>

        <Block title={de ? 'Ihre Rechte' : 'Your rights'}>
          <P>
            {de
              ? 'Sie haben das Recht auf Auskunft (Art. 15), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18), Datenübertragbarkeit (Art. 20) und Widerspruch (Art. 21 DSGVO) sowie das Recht, eine Einwilligung jederzeit mit Wirkung für die Zukunft zu widerrufen (Art. 7 Abs. 3 DSGVO). Wenden Sie sich dazu an die oben genannten Kontaktdaten. Außerdem können Sie sich bei einer Datenschutz-Aufsichtsbehörde beschweren (Art. 77 DSGVO).'
              : 'You have the right of access (Art. 15), rectification (Art. 16), erasure (Art. 17), restriction (Art. 18), data portability (Art. 20) and objection (Art. 21 GDPR), and may withdraw consent at any time (Art. 7(3)). Contact us using the details above. You may also lodge a complaint with a supervisory authority (Art. 77 GDPR).'}
          </P>
          {pr.supervisory_authority ? <P>{(de ? 'Zuständige Aufsichtsbehörde: ' : 'Competent authority: ') + pr.supervisory_authority}</P> : null}
          <P>
            {de
              ? 'Eine automatisierte Entscheidungsfindung einschließlich Profiling (Art. 22 DSGVO) findet nicht statt.'
              : 'No automated decision-making or profiling (Art. 22 GDPR) takes place.'}
          </P>
        </Block>
        <Text type="supporting">{t('legal.notLegalAdvice')}</Text>
      </VStack>
    </Section>
  );
}
