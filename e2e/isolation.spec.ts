import { expect, test } from '@playwright/test';
import { ownerLogin, rpc } from './helpers';

test('two tenants share one build but are fully isolated', async ({ page, request }) => {
  // shells: per-tenant title, manifest, scope
  await page.goto('/s/demo-studio/book');
  await expect(page).toHaveTitle('Demo Barber Studio');
  await expect(page.locator('link[rel=manifest]')).toHaveAttribute('href', '/s/demo-studio/manifest.webmanifest');
  await page.goto('/s/demo-harbor/my');
  await expect(page).toHaveTitle('Harbor Cuts (Demo)');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  const m1 = await (await request.get('/s/demo-studio/manifest.webmanifest')).json();
  const m2 = await (await request.get('/s/demo-harbor/manifest.webmanifest')).json();
  expect([m1.id, m1.scope, m1.start_url]).toEqual(['/s/demo-studio/', '/s/demo-studio/', '/s/demo-studio/']);
  expect([m2.id, m2.scope]).toEqual(['/s/demo-harbor/', '/s/demo-harbor/']);
  expect(m1.theme_color).not.toBe(m2.theme_color);
  expect(m1.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true);

  // content comes from each tenant's DB rows only
  await page.goto('/s/demo-harbor/');
  await expect(page.getByRole('heading', { level: 1, name: 'Harbor Cuts (Demo)' })).toBeVisible();
  await expect(page.getByText('Skin fade')).toBeVisible();
  await expect(page.getByText('Herrenhaarschnitt')).toHaveCount(0);

  // a booking token of shop A does not open in shop B
  const shop = await rpc<{ services: { id: string }[] }>('get_tenant_public', { p_slug: 'demo-studio' });
  const svc = shop.services[0]!.id;
  const dates = await rpc<{ dates: { date: string; slots: number }[] }>('get_available_dates', { p_slug: 'demo-studio', p_service_id: svc, p_barber_id: null, p_from: null, p_days: 14 });
  const day = dates.dates.find((d) => d.slots > 0)!.date;
  const slots = await rpc<{ slots: { starts_at: string }[] }>('get_available_slots', { p_slug: 'demo-studio', p_service_id: svc, p_barber_id: null, p_date: day });
  const b = await rpc<{ token: string }>('create_booking', { p_slug: 'demo-studio', p_service_id: svc, p_barber_id: null, p_starts_at: slots.slots.at(-1)!.starts_at, p_customer: { name: 'Iso Test', phone: '+49 151 4444 5555' }, p_idempotency_key: crypto.randomUUID() });
  await page.goto(`/s/demo-harbor/booking#${b.token}`);
  await expect(page.getByText('Booking not found')).toBeVisible();
  await page.goto(`/s/demo-studio/booking#${b.token}`);
  await expect(page.getByTestId('booking-status')).toHaveText('Bestätigt');

  // staff of shop B has no access to shop A's cabinet
  await ownerLogin(page, 'demo-studio', 'owner@demo-harbor.test');
  await expect(page.getByText('Ihr Konto hat keinen Zugriff auf diesen Barbershop.')).toBeVisible();

  // unknown slug → not found, no data from other tenants
  await page.goto('/s/does-not-exist/');
  await expect(page.getByRole('heading', { name: /nicht gefunden|not found/i })).toBeVisible();
});
