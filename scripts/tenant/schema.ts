import { z } from 'zod';

/**
 * business.json — the single input that re-skins the app for a new barbershop.
 * Human-friendly units (HH:MM ranges, prices in major units, hours) are
 * normalized to DB units (minutes, cents) by `normalize()`.
 */
const HHMM_RANGE = /^([01]\d|2[0-3]):[0-5]\d-(([01]\d|2[0-3]):[0-5]\d|24:00)$/;
const KEY = /^[a-z0-9][a-z0-9-]{0,40}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;

const Ranges = z.array(z.string().regex(HHMM_RANGE, 'expected "HH:MM-HH:MM"'));
const Week = z
  .object({ mon: Ranges, tue: Ranges, wed: Ranges, thu: Ranges, fri: Ranges, sat: Ranges, sun: Ranges })
  .partial()
  .strict();

const ImagePath = z.string().regex(/^images\/[\w./-]+\.(jpe?g|png|webp)$/i, 'image must live under images/ (jpg, png or webp)');

export const BusinessSchema = z
  .object({
    $schema: z.string().optional(),
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, 'lowercase letters, digits and dashes (3–40 chars)'),
    name: z.string().min(1).max(80),
    short_name: z.string().min(1).max(24),
    tagline: z.string().max(140).optional(),
    description: z.string().max(2000).optional(),
    locale: z.enum(['de', 'en', 'ru']),
    timezone: z.string().min(3),
    currency: z.string().regex(/^[A-Z]{3}$/),
    is_demo: z.boolean().default(false),
    brand: z
      .object({
        accent_color: z.string().regex(HEX),
        background_color: z.string().regex(HEX).default('#0E0E10'),
        logo: ImagePath.optional(),
        icon: ImagePath,
        maskable_icon: ImagePath.optional(),
        cover: ImagePath,
      })
      .strict(),
    contact: z
      .object({
        phone: z.string().min(5).max(30),
        email: z.string().email().optional(),
        instagram: z.string().max(60).optional(),
        website: z.string().url().optional(),
      })
      .strict(),
    location: z
      .object({
        address_line: z.string().min(3).max(200),
        city: z.string().min(1).max(100),
        postal_code: z.string().max(20).optional(),
        country: z.string().max(60).optional(),
        lat: z.number().min(-90).max(90).optional(),
        lng: z.number().min(-180).max(180).optional(),
        map_url: z.string().url().optional(),
      })
      .strict(),
    legal: z
      .object({
        // Impressum (§ 5 DDG). Rendered at /s/{slug}/impressum.
        impressum: z
          .object({
            legal_name: z.string().min(2).max(160),
            legal_form: z.string().max(80).optional(),
            represented_by: z.string().max(160).optional(),
            street: z.string().min(3).max(160),
            postal_code: z.string().min(2).max(20),
            city: z.string().min(1).max(100),
            country: z.string().max(60).default('Deutschland'),
            email: z.string().email(),
            phone: z.string().max(40).optional(),
            register: z.object({ court: z.string().min(2).max(120), number: z.string().min(2).max(60) }).strict().optional(),
            vat_id: z.string().regex(/^[A-Z]{2}[A-Z0-9]{2,12}$/, 'USt-IdNr like DE123456789').optional(),
            tax_number: z.string().max(40).optional(),
            profession: z
              .object({
                title: z.string().max(80),
                awarded_in: z.string().max(60).default('Deutschland'),
                chamber: z.string().max(160),
                rules: z.string().max(200).default('Handwerksordnung (HwO)'),
                rules_url: z.string().url().default('https://www.gesetze-im-internet.de/hwo/'),
              })
              .strict()
              .optional(),
            content_responsible: z.object({ name: z.string().max(120), address: z.string().max(200) }).strict().optional(),
            dispute_resolution: z.enum(['not_willing', 'willing', 'obliged']).default('not_willing'),
          })
          .strict(),
        // Data for the generated privacy notice (DSGVO Art. 13).
        privacy: z
          .object({
            dpo: z.object({ name: z.string().max(120), email: z.string().email() }).strict().optional(),
            supervisory_authority: z.string().max(200).optional(),
            retention_months: z.number().int().min(6).max(120).default(36),
            hosting: z.string().max(200).default('Supabase (EU, Frankfurt) · Cloudflare Pages'),
            ai_provider: z.string().max(200).optional(),
            extra_processors: z
              .array(z.object({ name: z.string().max(120), purpose: z.string().max(200), location: z.string().max(120) }).strict())
              .default([]),
          })
          .strict()
          .default({ retention_months: 36, hosting: 'Supabase (EU, Frankfurt) · Cloudflare Pages', extra_processors: [] }),
      })
      .strict(),
    opening_hours: Week,
    rules: z
      .object({
        slot_step_min: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(60)]).default(15),
        min_lead_min: z.number().int().min(0).max(10080).default(60),
        max_advance_days: z.number().int().min(1).max(365).default(60),
        cancellation: z.object({ allowed: z.boolean(), min_notice_hours: z.number().min(0).max(336) }).strict(),
        reschedule: z
          .object({ allowed: z.boolean(), min_notice_hours: z.number().min(0).max(336), max_per_booking: z.number().int().min(0).max(20).default(3) })
          .strict(),
      })
      .strict(),
    notifications: z
      .object({
        reminders_before_min: z.array(z.number().int().min(5).max(10080)).max(4).default([1440, 120]),
        notify_staff: z.boolean().default(true),
      })
      .strict()
      .default({ reminders_before_min: [1440, 120], notify_staff: true }),
    ai: z
      .object({
        enabled: z.boolean().default(true),
        daily_request_limit: z.number().int().min(0).max(100000).default(300),
        daily_token_limit: z.number().int().min(0).max(100000000).default(300000),
      })
      .strict()
      .default({ enabled: true, daily_request_limit: 300, daily_token_limit: 300000 }),
    services: z
      .array(
        z
          .object({
            key: z.string().regex(KEY),
            name: z.string().min(1).max(80),
            description: z.string().max(1000).optional(),
            duration_min: z.number().int().min(5).max(480),
            buffer_min: z.number().int().min(0).max(120).default(0),
            price: z.number().min(0).max(1000000),
            active: z.boolean().default(true),
            policy: z
              .object({
                cancellation_allowed: z.boolean().optional(),
                cancellation_min_notice_hours: z.number().min(0).max(336).optional(),
                reschedule_allowed: z.boolean().optional(),
                reschedule_min_notice_hours: z.number().min(0).max(336).optional(),
              })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .min(1),
    barbers: z
      .array(
        z
          .object({
            key: z.string().regex(KEY),
            name: z.string().min(1).max(60),
            title: z.string().max(60).optional(),
            bio: z.string().max(1000).optional(),
            photo: ImagePath.optional(),
            specialties: z.array(z.string().min(1).max(40)).max(10).default([]),
            color: z.string().regex(HEX).default('#9CA3AF'),
            marker: z.string().max(3).default(''),
            active: z.boolean().default(true),
            services: z.array(z.string().regex(KEY)).min(1),
            schedule: Week,
            breaks: Week.default({}),
          })
          .strict(),
      )
      .min(1),
    photos: z
      .array(
        z
          .object({
            key: z.string().regex(KEY),
            kind: z.enum(['interior', 'work']),
            file: ImagePath,
            alt: z.string().min(1).max(200),
          })
          .strict(),
      )
      .default([]),
    special_dates: z
      .array(
        z
          .object({
            date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            barber: z.string().regex(KEY).nullable().default(null),
            closed: z.boolean().default(false),
            hours: Ranges.default([]),
            note: z.string().max(200).default(''),
          })
          .strict(),
      )
      .default([]),
    demo: z
      .object({
        bookings: z
          .array(
            z
              .object({
                day_offset: z.number().int().min(-30).max(30),
                time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
                service: z.string().regex(KEY),
                barber: z.string().regex(KEY).nullable(),
                customer: z.object({ name: z.string(), phone: z.string(), email: z.string().email().optional() }).strict(),
                status: z.enum(['confirmed', 'completed', 'cancelled']).default('confirmed'),
              })
              .strict(),
          )
          .default([]),
      })
      .strict()
      .optional(),
    credits: z.array(z.object({ file: z.string(), author: z.string(), source: z.string().url(), license: z.string() }).strict()).default([]),
  })
  .strict();

export type Business = z.infer<typeof BusinessSchema>;

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export function parseRange(r: string): { start_min: number; end_min: number } {
  const [a, b] = r.split('-') as [string, string];
  const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  return { start_min: toMin(a), end_min: toMin(b) };
}

export function weekToIntervals(week: z.infer<typeof Week>, withLabel = false) {
  const out: { weekday: number; start_min: number; end_min: number; label?: string }[] = [];
  WEEKDAYS.forEach((d, i) => {
    for (const r of week[d] ?? []) out.push({ weekday: i + 1, ...parseRange(r), ...(withLabel ? { label: '' } : {}) });
  });
  return out;
}
