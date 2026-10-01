import { z } from 'zod';

// Runtime validation of every RPC payload the UI consumes. If the DB contract
// drifts, the UI fails loudly in the error state instead of rendering garbage.

const nullableStr = z.string().nullable().optional().transform((v) => v ?? null);

export const RulesSchema = z.object({
  slot_step_min: z.number(),
  min_lead_min: z.number(),
  max_advance_days: z.number(),
  allow_self_cancel: z.boolean(),
  cancel_min_notice_min: z.number(),
  allow_self_reschedule: z.boolean(),
  reschedule_min_notice_min: z.number(),
});

const opt = z.string().optional();
export const LegalSchema = z
  .object({
    impressum: z
      .object({
        legal_name: opt, legal_form: opt, represented_by: opt, street: opt, postal_code: opt, city: opt, country: opt,
        email: opt, phone: opt, vat_id: opt, tax_number: opt,
        register: z.object({ court: z.string(), number: z.string() }).optional(),
        profession: z.object({ title: z.string(), awarded_in: opt, chamber: z.string(), rules: opt, rules_url: opt }).optional(),
        content_responsible: z.object({ name: z.string(), address: z.string() }).optional(),
        dispute_resolution: z.enum(['not_willing', 'willing', 'obliged']).optional(),
      })
      .partial()
      .optional(),
    privacy: z
      .object({
        dpo: z.object({ name: z.string(), email: z.string() }).optional(),
        supervisory_authority: opt,
        retention_months: z.number().optional(),
        hosting: opt,
        ai_provider: opt,
        extra_processors: z.array(z.object({ name: z.string(), purpose: z.string(), location: z.string() })).optional(),
      })
      .partial()
      .optional(),
  })
  .passthrough();
export type Legal = z.infer<typeof LegalSchema>;

export const PublicTenantSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  status: z.enum(['preview', 'live', 'suspended']),
  is_demo: z.boolean(),
  name: z.string(),
  short_name: z.string(),
  tagline: nullableStr,
  description: nullableStr,
  timezone: z.string(),
  locale: z.enum(['de', 'en', 'ru']),
  currency: z.string(),
  accent_color: z.string(),
  phone: nullableStr,
  email: nullableStr,
  address_line: nullableStr,
  city: nullableStr,
  postal_code: nullableStr,
  country: nullableStr,
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  map_url: nullableStr,
  instagram: nullableStr,
  website: nullableStr,
  logo_path: nullableStr,
  cover_path: nullableStr,
  ai_enabled: z.boolean(),
  legal: LegalSchema,
  retention_months: z.number(),
  rules: RulesSchema,
});

export const PublicServiceSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: nullableStr,
  duration_min: z.number(),
  price_cents: z.number(),
  barber_ids: z.array(z.string().uuid()),
});

export const PublicBarberSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  title: nullableStr,
  bio: nullableStr,
  photo_path: nullableStr,
  specialties: z.array(z.string()),
  color: z.string(),
  marker: z.string(),
  service_ids: z.array(z.string().uuid()),
  works_today: z.boolean(),
});

export const ShopPayloadSchema = z.object({
  tenant: PublicTenantSchema,
  today: z.string(),
  opening_hours: z.array(z.object({ weekday: z.number(), start_min: z.number(), end_min: z.number() })),
  photos: z.array(z.object({ id: z.string(), kind: z.enum(['cover', 'interior', 'work']), path: z.string(), alt: z.string() })),
  services: z.array(PublicServiceSchema),
  barbers: z.array(PublicBarberSchema),
});

export const SlotsSchema = z.object({
  date: z.string(),
  timezone: z.string(),
  out_of_range: z.boolean(),
  slots: z.array(z.object({ starts_at: z.string(), local_time: z.string(), barber_ids: z.array(z.string()) })),
});

export const DatesSchema = z.object({
  timezone: z.string(),
  today: z.string(),
  from: z.string(),
  to: z.string(),
  max_date: z.string(),
  dates: z.array(z.object({ date: z.string(), slots: z.number() })),
});

export const BookingActionsSchema = z.object({
  can_cancel: z.boolean(),
  cancel_block_reason: z.string().nullable(),
  cancel_deadline: z.string(),
  can_reschedule: z.boolean(),
  reschedule_block_reason: z.string().nullable(),
  reschedule_deadline: z.string(),
});

export const PublicBookingSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['confirmed', 'cancelled', 'completed', 'no_show']),
  starts_at: z.string(),
  ends_at: z.string(),
  timezone: z.string(),
  local_date: z.string(),
  local_time: z.string(),
  service: z.object({ id: z.string(), name: z.string(), duration_min: z.number(), price_cents: z.number(), currency: z.string() }),
  barber: z.object({ id: z.string(), name: z.string(), photo_path: nullableStr }),
  tenant: z.object({ slug: z.string(), name: z.string(), phone: nullableStr, address_line: nullableStr, city: nullableStr, map_url: nullableStr }),
  customer: z.object({ name: z.string(), phone_masked: z.string(), email: nullableStr }),
  version: z.number(),
  reschedule_count: z.number(),
  is_demo: z.boolean(),
  cancelled_at: nullableStr,
  actions: BookingActionsSchema,
});

export const CreateBookingResultSchema = z.object({
  booking_id: z.string().uuid(),
  replayed: z.boolean(),
  token: z.string(),
  booking: PublicBookingSchema,
});

export const BarbersOnDateSchema = z.object({
  date: z.string(),
  timezone: z.string(),
  barbers: z.array(z.object({ id: z.string(), name: z.string(), intervals: z.array(z.object({ start: z.string(), end: z.string() })) })),
});

export type ShopPayload = z.infer<typeof ShopPayloadSchema>;
export type PublicTenant = z.infer<typeof PublicTenantSchema>;
export type PublicService = z.infer<typeof PublicServiceSchema>;
export type PublicBarber = z.infer<typeof PublicBarberSchema>;
export type Slots = z.infer<typeof SlotsSchema>;
export type AvailableDates = z.infer<typeof DatesSchema>;
export type PublicBooking = z.infer<typeof PublicBookingSchema>;
export type CreateBookingResult = z.infer<typeof CreateBookingResultSchema>;
