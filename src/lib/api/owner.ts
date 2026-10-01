import { z } from 'zod';
import { rpc } from './public';
import { LegalSchema } from './schemas';

const uuid = z.string().uuid();
const ns = z.string().nullable().optional().transform((v) => v ?? null);
const Interval = z.object({ weekday: z.number(), start_min: z.number(), end_min: z.number() });

export const MembershipSchema = z.object({
  tenant_id: uuid,
  slug: z.string(),
  name: z.string(),
  status: z.string(),
  role: z.enum(['owner', 'admin', 'barber']),
  barber_id: uuid.nullable(),
  timezone: z.string(),
  currency: z.string(),
  locale: z.string(),
  accent_color: z.string(),
});
export type Membership = z.infer<typeof MembershipSchema>;
export type Role = Membership['role'];

export const OwnerBarberSchema = z.object({
  id: uuid,
  pipeline_key: ns,
  managed_by: z.enum(['pipeline', 'owner']),
  name: z.string(),
  title: ns,
  bio: ns,
  photo_path: ns,
  specialties: z.array(z.string()),
  color: z.string(),
  marker: z.string(),
  is_active: z.boolean(),
  sort_order: z.number(),
  service_ids: z.array(uuid),
  weekly_hours: z.array(Interval),
  weekly_breaks: z.array(Interval.extend({ label: z.string() })),
});
export type OwnerBarber = z.infer<typeof OwnerBarberSchema>;

export const OwnerServiceSchema = z.object({
  id: uuid,
  pipeline_key: ns,
  managed_by: z.enum(['pipeline', 'owner']),
  name: z.string(),
  description: ns,
  duration_min: z.number(),
  buffer_min: z.number(),
  price_cents: z.number(),
  is_active: z.boolean(),
  sort_order: z.number(),
  allow_self_cancel: z.boolean().nullable(),
  cancel_min_notice_min: z.number().nullable(),
  allow_self_reschedule: z.boolean().nullable(),
  reschedule_min_notice_min: z.number().nullable(),
  barber_ids: z.array(uuid),
});
export type OwnerService = z.infer<typeof OwnerServiceSchema>;

export const OwnerTenantSchema = z
  .object({
    id: uuid,
    slug: z.string(),
    status: z.enum(['preview', 'live', 'suspended']),
    is_demo: z.boolean(),
    name: z.string(),
    short_name: z.string(),
    tagline: ns,
    description: ns,
    timezone: z.string(),
    locale: z.enum(['de', 'en', 'ru']),
    currency: z.string(),
    accent_color: z.string(),
    phone: ns,
    email: ns,
    address_line: ns,
    city: ns,
    postal_code: ns,
    map_url: ns,
    instagram: ns,
    website: ns,
    logo_path: ns,
    cover_path: ns,
    legal: LegalSchema,
    retention_months: z.number(),
    slot_step_min: z.number(),
    min_lead_min: z.number(),
    max_advance_days: z.number(),
    allow_self_cancel: z.boolean(),
    cancel_min_notice_min: z.number(),
    allow_self_reschedule: z.boolean(),
    reschedule_min_notice_min: z.number(),
    max_self_reschedules: z.number(),
    reminder_offsets_min: z.array(z.number()),
    notify_staff: z.boolean(),
    ai_enabled: z.boolean(),
    ai_daily_request_limit: z.number(),
    owner_overrides: z.array(z.string()),
  })
  .passthrough();
export type OwnerTenant = z.infer<typeof OwnerTenantSchema>;

export const WorkspaceSchema = z.object({
  role: z.enum(['owner', 'admin', 'barber']),
  my_barber_id: uuid.nullable(),
  today: z.string(),
  tenant: OwnerTenantSchema,
  opening_hours: z.array(Interval.passthrough()),
  services: z.array(OwnerServiceSchema),
  barbers: z.array(OwnerBarberSchema),
  overrides: z.array(
    z.object({ id: uuid, barber_id: uuid.nullable(), on_date: z.string(), start_min: z.number().nullable(), end_min: z.number().nullable(), note: z.string(), source: z.string() }).passthrough(),
  ),
  blocks: z.array(
    z.object({ id: uuid, barber_id: uuid.nullable(), kind: z.string(), note: z.string(), starts_at: z.string(), ends_at: z.string() }).passthrough(),
  ),
  photos: z.array(
    z.object({ id: uuid, kind: z.enum(['cover', 'interior', 'work']), storage_path: z.string(), alt: z.string(), sort_order: z.number(), source: z.enum(['pipeline', 'owner']), is_active: z.boolean() }).passthrough(),
  ),
  members: z.array(z.object({ user_id: uuid, email: z.string().nullable(), role: z.string(), barber_id: uuid.nullable() })),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

const Range = z.object({ start: z.string(), end: z.string() });
export const CalBookingSchema = z.object({
  id: uuid,
  status: z.enum(['confirmed', 'cancelled', 'completed', 'no_show']),
  starts_at: z.string(),
  ends_at: z.string(),
  occupied_until: z.string(),
  barber_id: uuid,
  barber_name: z.string(),
  service_id: uuid,
  service_name: z.string(),
  duration_min: z.number(),
  price_cents: z.number(),
  currency: z.string(),
  customer_id: uuid,
  customer_name: z.string(),
  customer_phone: z.string(),
  source: z.string(),
  is_demo: z.boolean(),
  internal_note: z.string(),
  cancel_reason: ns,
  cancelled_by: ns,
  paid_cents: z.number(),
});
export type CalBooking = z.infer<typeof CalBookingSchema>;

export const CalendarSchema = z.object({
  timezone: z.string(),
  from: z.string(),
  to: z.string(),
  now: z.string(),
  barbers: z.array(z.object({ id: uuid, name: z.string(), color: z.string(), marker: z.string(), is_active: z.boolean(), photo_path: ns })),
  bookings: z.array(CalBookingSchema),
  blocks: z.array(z.object({ id: uuid, barber_id: uuid.nullable(), kind: z.string(), note: z.string(), starts_at: z.string(), ends_at: z.string() })),
  days: z.array(z.object({ date: z.string(), barber_id: uuid, work: z.array(Range), breaks: z.array(Range), free: z.array(Range) })),
});
export type Calendar = z.infer<typeof CalendarSchema>;

export const BookingDetailsSchema = z.object({
  booking: z.object({ id: uuid, status: z.string(), starts_at: z.string(), barber_id: uuid, service_id: uuid, customer_id: uuid, snap_policy: z.unknown() }).passthrough(),
  events: z.array(z.object({ at: z.string(), type: z.string(), actor: z.string(), data: z.unknown() })),
  payments: z.array(z.object({ id: uuid, kind: z.enum(['payment', 'refund']), amount_cents: z.number(), currency: z.string(), method: z.string(), paid_at: z.string(), note: z.string() })),
  notifications: z.array(z.object({ audience: z.string(), event: z.string(), status: z.string(), status_reason: ns, run_at: z.string() })),
  has_customer_push: z.boolean(),
});
export type BookingDetails = z.infer<typeof BookingDetailsSchema>;

export const CustomerRowSchema = z.object({
  id: uuid,
  name: z.string(),
  phone: z.string(),
  email: ns,
  is_demo: z.boolean(),
  visits: z.number(),
  no_shows: z.number(),
  last_visit: ns,
  next_visit: ns,
});
export type CustomerRow = z.infer<typeof CustomerRowSchema>;

export const CustomerCardSchema = z.object({
  customer: z.object({ id: uuid, name: z.string(), phone: z.string(), email: ns, internal_note: z.string(), created_at: z.string(), is_demo: z.boolean(), anonymized_at: ns }).passthrough(),
  history: z.array(
    z.object({ id: uuid, status: z.string(), starts_at: z.string(), service_name: z.string(), barber_name: z.string(), price_cents: z.number(), currency: z.string(), paid_cents: z.number().nullable() }),
  ),
});
export type CustomerCard = z.infer<typeof CustomerCardSchema>;

const Totals = z.object({
  bookings_total: z.number(),
  upcoming_count: z.number(),
  upcoming_value_cents: z.number(),
  awaiting_close_count: z.number(),
  completed_count: z.number(),
  completed_value_cents: z.number(),
  cancelled_count: z.number(),
  cancelled_by_client: z.number(),
  cancelled_by_staff: z.number(),
  no_show_count: z.number(),
  received_cents: z.number(),
  refunded_cents: z.number(),
  unique_customers: z.number(),
});
export const StatsSchema = z.object({
  period: z.object({ from: z.string(), to: z.string(), timezone: z.string() }).passthrough(),
  filters: z.object({ barber_id: uuid.nullable(), service_id: uuid.nullable() }),
  currency: z.string(),
  totals: Totals,
  by_barber: z.array(z.object({ barber_id: uuid, name: z.string(), is_active: z.boolean(), completed_count: z.number(), upcoming_count: z.number(), cancelled_count: z.number(), no_show_count: z.number(), received_cents: z.number() })),
  by_service: z.array(z.object({ service_id: uuid, name: z.string(), completed_count: z.number(), upcoming_count: z.number(), cancelled_count: z.number(), received_cents: z.number() })),
  daily: z.array(z.object({ date: z.string(), booked_count: z.number(), completed_count: z.number(), cancelled_count: z.number(), received_cents: z.number() })),
});
export type Stats = z.infer<typeof StatsSchema>;

const Any = z.unknown();
const Json = z.record(z.string(), z.unknown());

/** Typed wrappers for the owner RPCs. The DB checks membership on every call. */
export function ownerApi(slug: string, tenantId: string) {
  const call = <S extends z.ZodTypeAny>(fn: string, args: Record<string, unknown>, schema: S) =>
    rpc(slug, fn, { p_tenant_id: tenantId, ...args }, schema);
  return {
    workspace: () => call('owner_workspace', {}, WorkspaceSchema),
    calendar: (from: string, to: string, barberId: string | null) => call('owner_calendar', { p_from: from, p_to: to, p_barber_id: barberId }, CalendarSchema),
    bookingDetails: (id: string) => call('owner_booking_details', { p_booking_id: id }, BookingDetailsSchema),
    createBooking: (i: { serviceId: string; barberId: string | null; startsAt: string; customer: Record<string, unknown>; note: string; ignoreHours: boolean; key: string }) =>
      call('owner_create_booking', { p_service_id: i.serviceId, p_barber_id: i.barberId, p_starts_at: i.startsAt, p_customer: i.customer, p_note: i.note, p_ignore_hours: i.ignoreHours, p_idempotency_key: i.key }, Json),
    reschedule: (id: string, startsAt: string, barberId: string | null, ignoreHours: boolean, key: string) =>
      call('owner_reschedule_booking', { p_booking_id: id, p_new_starts_at: startsAt, p_barber_id: barberId, p_ignore_hours: ignoreHours, p_idempotency_key: key }, Json),
    cancel: (id: string, reason: string | null) => call('owner_cancel_booking', { p_booking_id: id, p_reason: reason }, Json),
    setStatus: (id: string, status: 'completed' | 'no_show' | 'confirmed') => call('owner_set_booking_status', { p_booking_id: id, p_status: status }, Json),
    setNote: (id: string, note: string) => call('owner_update_booking_note', { p_booking_id: id, p_note: note }, Any),
    accessToken: (id: string) => call('owner_booking_access_token', { p_booking_id: id }, z.string().nullable()),
    recordPayment: (id: string, amountCents: number, method: string, kind: 'payment' | 'refund', note: string, key: string) =>
      call('owner_record_payment', { p_booking_id: id, p_amount_cents: amountCents, p_method: method, p_kind: kind, p_note: note, p_idempotency_key: key }, Json),
    upsertBarber: (b: Record<string, unknown>) => call('owner_upsert_barber', { p_barber: b }, uuid),
    setBarberServices: (barberId: string, ids: string[]) => call('owner_set_barber_services', { p_barber_id: barberId, p_service_ids: ids }, Any),
    setBarberSchedule: (barberId: string, hours: unknown[], breaks: unknown[]) => call('owner_set_barber_schedule', { p_barber_id: barberId, p_hours: hours, p_breaks: breaks }, Any),
    setOverride: (barberId: string | null, date: string, intervals: { start_min: number; end_min: number }[] | null, note: string) =>
      call('owner_set_override', { p_barber_id: barberId, p_date: date, p_intervals: intervals, p_note: note }, Any),
    deleteOverride: (barberId: string | null, date: string) => call('owner_delete_override', { p_barber_id: barberId, p_date: date }, Any),
    createBlock: (barberId: string | null, startsAt: string, endsAt: string, kind: string, note: string) =>
      call('owner_create_block', { p_barber_id: barberId, p_starts_at: startsAt, p_ends_at: endsAt, p_kind: kind, p_note: note }, Json),
    deleteBlock: (id: string) => call('owner_delete_block', { p_block_id: id }, Any),
    upsertService: (s: Record<string, unknown>) => call('owner_upsert_service', { p_service: s }, uuid),
    customers: (search: string) => call('owner_list_customers', { p_search: search, p_limit: 100 }, z.array(CustomerRowSchema)),
    customer: (id: string) => call('owner_get_customer', { p_customer_id: id }, CustomerCardSchema),
    updateCustomer: (id: string, patch: Record<string, unknown>) => call('owner_update_customer', { p_customer_id: id, p_patch: patch }, Any),
    exportCustomer: (id: string) => call('owner_export_customer', { p_customer_id: id }, Json),
    anonymizeCustomer: (id: string) => call('owner_anonymize_customer', { p_customer_id: id }, Json),
    updateSettings: (patch: Record<string, unknown>) => call('owner_update_settings', { p_patch: patch }, Any),
    setOpeningHours: (hours: unknown[]) => call('owner_set_opening_hours', { p_hours: hours }, Any),
    addPhoto: (kind: string, path: string, alt: string) => call('owner_add_photo', { p_kind: kind, p_path: path, p_alt: alt }, uuid),
    updatePhoto: (id: string, patch: Record<string, unknown>) => call('owner_update_photo', { p_photo_id: id, p_patch: patch }, Any),
    deletePhoto: (id: string) => call('owner_delete_photo', { p_photo_id: id }, z.string()),
    stats: (from: string, to: string, barberId: string | null, serviceId: string | null) =>
      call('owner_stats', { p_from: from, p_to: to, p_barber_id: barberId, p_service_id: serviceId }, StatsSchema),
    goLiveCheck: () => call('owner_go_live_check', {}, z.object({ problems: z.array(z.string()), demo_bookings: z.number() })),
    goLive: () => call('owner_go_live', {}, Json),
    aiUsage: () => call('ai_usage', {}, z.object({ requests: z.number(), tokens: z.number(), request_limit: z.number(), token_limit: z.number(), enabled: z.boolean() }).passthrough()),
    registerPush: (sub: unknown) => call('owner_register_push', { p_subscription: sub, p_user_agent: navigator.userAgent }, uuid),
  };
}
export type OwnerApi = ReturnType<typeof ownerApi>;

export async function myTenants(slug: string): Promise<Membership[]> {
  return rpc(slug, 'owner_my_tenants', {}, z.array(MembershipSchema));
}
