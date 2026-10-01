import { expect, test } from '@playwright/test';
import { rpc, uniq } from './helpers';

interface Shop { services: { id: string; name: string }[]; barbers: { id: string; name: string }[] }
interface Dates { dates: { date: string; slots: number }[] }
interface Slots { slots: { starts_at: string; local_time: string }[] }

async function bookViaApi(name: string) {
  const shop = await rpc<Shop>('get_tenant_public', { p_slug: 'demo-studio' });
  const svc = shop.services.find((s) => s.name === 'Bartpflege')!;
  const marco = shop.barbers.find((b) => b.name === 'Marco')!;
  const dates = await rpc<Dates>('get_available_dates', { p_slug: 'demo-studio', p_service_id: svc.id, p_barber_id: marco.id, p_from: null, p_days: 14 });
  const day = dates.dates.find((d) => d.slots > 4)!.date;
  const slots = await rpc<Slots>('get_available_slots', { p_slug: 'demo-studio', p_service_id: svc.id, p_barber_id: marco.id, p_date: day });
  const res = await rpc<{ token: string }>('create_booking', {
    p_slug: 'demo-studio', p_service_id: svc.id, p_barber_id: marco.id, p_starts_at: slots.slots[0]!.starts_at,
    p_customer: { name, phone: '+49 151 9988 7766' }, p_idempotency_key: crypto.randomUUID(),
  });
  return { token: res.token, svc, marco, day, first: slots.slots[0]!.local_time };
}

test('client reschedules via the booking link; a lost race keeps the original booking', async ({ page }) => {
  const b = await bookViaApi(`E2E Umbuchung ${uniq()}`);
  await page.goto(`/s/demo-studio/booking#${b.token}`);
  await expect(page.getByTestId('booking-when')).toContainText(b.first);

  // 1) lost race: pick a slot, someone else takes it before we confirm
  await page.getByTestId('reschedule-btn').click();
  const sheet = page.getByTestId('sheet-reschedule');
  await expect(sheet).toBeVisible();
  await sheet.locator(`[data-date="${b.day}"]`).click();
  const target = sheet.locator('[data-slot-time]').nth(3);
  const targetTime = (await target.getAttribute('data-slot-time'))!;
  await target.click();
  const slots = await rpc<Slots>('get_available_slots', { p_slug: 'demo-studio', p_service_id: b.svc.id, p_barber_id: b.marco.id, p_date: b.day });
  const taken = slots.slots.find((s) => s.local_time === targetTime)!;
  await rpc('create_booking', { p_slug: 'demo-studio', p_service_id: b.svc.id, p_barber_id: b.marco.id, p_starts_at: taken.starts_at, p_customer: { name: 'Racer', phone: '+49 151 1112 2233' }, p_idempotency_key: crypto.randomUUID() });
  await page.getByTestId('confirm-reschedule').click();
  await expect(sheet.getByText('Diese Zeit wurde gerade vergeben')).toBeVisible();
  const still = await rpc<{ local_time: string }>('get_booking_by_token', { p_token: b.token, p_slug: 'demo-studio' });
  expect(still.local_time).toBe(b.first);

  // 2) successful reschedule to another free slot
  const free = sheet.locator('[data-slot-time]').filter({ hasNotText: targetTime }).nth(4);
  const newTime = (await free.getAttribute('data-slot-time'))!;
  await free.click();
  await page.getByTestId('confirm-reschedule').click();
  await expect(page.getByTestId('booking-when')).toContainText(newTime);
  const moved = await rpc<{ local_time: string; version: number }>('get_booking_by_token', { p_token: b.token, p_slug: 'demo-studio' });
  expect(moved.local_time).toBe(newTime);
  expect(moved.version).toBe(2);
});
