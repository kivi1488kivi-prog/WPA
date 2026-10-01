/**
 * Notification texts. Times are formatted in the TENANT timezone (never the
 * server's), in the tenant language. Customer URLs never contain the access
 * token (the server only knows its hash) — they open "My visits" on the device.
 */
export interface NotificationJob {
  job_id: string;
  audience: 'customer' | 'staff';
  event: 'created' | 'rescheduled' | 'cancelled' | 'reminder';
  tenant: { slug: string; name: string; locale: string; timezone: string };
  booking: { id: string; starts_at: string; service_name: string; barber_name: string; customer_name: string; timezone: string };
}

type L = 'de' | 'en' | 'ru';
const T: Record<L, Record<string, string>> = {
  de: {
    'staff.created': 'Neue Buchung',
    'staff.rescheduled': 'Termin verschoben',
    'staff.cancelled': 'Termin storniert',
    'customer.rescheduled': 'Ihr Termin wurde verschoben',
    'customer.cancelled': 'Ihr Termin wurde storniert',
    'customer.reminder': 'Erinnerung an Ihren Termin',
    with: 'bei',
  },
  en: {
    'staff.created': 'New booking',
    'staff.rescheduled': 'Booking moved',
    'staff.cancelled': 'Booking cancelled',
    'customer.rescheduled': 'Your appointment was moved',
    'customer.cancelled': 'Your appointment was cancelled',
    'customer.reminder': 'Appointment reminder',
    with: 'with',
  },
  ru: {
    'staff.created': 'Новая запись',
    'staff.rescheduled': 'Запись перенесена',
    'staff.cancelled': 'Запись отменена',
    'customer.rescheduled': 'Ваша запись перенесена',
    'customer.cancelled': 'Ваша запись отменена',
    'customer.reminder': 'Напоминание о визите',
    with: 'у',
  },
};

const INTL: Record<L, string> = { de: 'de-DE', en: 'en-US', ru: 'ru-RU' };

export function formatWhen(iso: string, tz: string, locale: string): string {
  const l = (['de', 'en', 'ru'].includes(locale) ? locale : 'en') as L;
  return new Intl.DateTimeFormat(INTL[l], { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}

export function buildMessage(job: NotificationJob): { title: string; body: string; url: string; tag: string } {
  const l = (['de', 'en', 'ru'].includes(job.tenant.locale) ? job.tenant.locale : 'en') as L;
  const t = T[l];
  const when = formatWhen(job.booking.starts_at, job.tenant.timezone, l);
  const base = `/s/${job.tenant.slug}/`;
  const title = t[`${job.audience}.${job.event}`] ?? job.tenant.name;
  const body =
    job.audience === 'staff'
      ? `${job.booking.customer_name} · ${job.booking.service_name} · ${when} · ${job.booking.barber_name}`
      : `${when} · ${job.booking.service_name} ${t.with} ${job.booking.barber_name} · ${job.tenant.name}`;
  return { title, body, url: job.audience === 'staff' ? `${base}owner/` : `${base}my`, tag: `booking-${job.booking.id}` };
}
