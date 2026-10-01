import type { z } from 'zod';
import { getSupabase } from '../supabase';
import { toApiError } from './errors';
import {
  BarbersOnDateSchema,
  CreateBookingResultSchema,
  DatesSchema,
  PublicBookingSchema,
  ShopPayloadSchema,
  SlotsSchema,
} from './schemas';

export async function rpc<S extends z.ZodTypeAny>(slug: string, fn: string, args: Record<string, unknown>, schema: S): Promise<z.infer<S>> {
  let data: unknown;
  try {
    const res = await getSupabase(slug).rpc(fn, args);
    if (res.error) throw res.error;
    data = res.data;
  } catch (err) {
    throw toApiError(err);
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    // Contract drift between DB and UI: surface as unknown error with detail.
    throw toApiError({ message: 'contract_mismatch', details: parsed.error.message });
  }
  return parsed.data;
}

export const publicApi = {
  shop: (slug: string) => rpc(slug, 'get_tenant_public', { p_slug: slug }, ShopPayloadSchema),

  slots: (slug: string, serviceId: string, barberId: string | null, date: string) =>
    rpc(slug, 'get_available_slots', { p_slug: slug, p_service_id: serviceId, p_barber_id: barberId, p_date: date }, SlotsSchema),

  dates: (slug: string, serviceId: string, barberId: string | null, from: string | null, days = 14) =>
    rpc(slug, 'get_available_dates', { p_slug: slug, p_service_id: serviceId, p_barber_id: barberId, p_from: from, p_days: days }, DatesSchema),

  barbersOnDate: (slug: string, date: string | null) =>
    rpc(slug, 'get_barbers_on_date', { p_slug: slug, p_date: date }, BarbersOnDateSchema),

  createBooking: (
    slug: string,
    input: { serviceId: string; barberId: string | null; startsAt: string; name: string; phone: string; email: string; idempotencyKey: string },
  ) =>
    rpc(
      slug,
      'create_booking',
      {
        p_slug: slug,
        p_service_id: input.serviceId,
        p_barber_id: input.barberId,
        p_starts_at: input.startsAt,
        p_customer: { name: input.name, phone: input.phone, email: input.email || null },
        p_idempotency_key: input.idempotencyKey,
      },
      CreateBookingResultSchema,
    ),

  booking: (slug: string, token: string) => rpc(slug, 'get_booking_by_token', { p_token: token, p_slug: slug }, PublicBookingSchema),

  cancel: (slug: string, token: string, reason: string | null) =>
    rpc(slug, 'cancel_booking_by_token', { p_token: token, p_reason: reason, p_slug: slug }, PublicBookingSchema),

  reschedule: (slug: string, token: string, input: { startsAt: string; barberId: string | null; anyBarber: boolean; idempotencyKey: string }) =>
    rpc(
      slug,
      'reschedule_booking_by_token',
      {
        p_token: token,
        p_new_starts_at: input.startsAt,
        p_barber_id: input.barberId,
        p_any_barber: input.anyBarber,
        p_idempotency_key: input.idempotencyKey,
        p_slug: slug,
      },
      PublicBookingSchema,
    ),
};
