import { expect, test } from '@playwright/test';
import { bookViaUi, ownerLogin, uniq } from './helpers';

test('client books (service → barber → slot → details) and the booking appears in the owner cabinet', async ({ page, browser }) => {
  const name = `E2E Kunde ${uniq()}`;
  await page.goto('/s/demo-studio/');
  await expect(page.getByRole('heading', { level: 1, name: 'Demo Barber Studio' })).toBeVisible();
  await page.getByTestId('hero-book').click();
  await expect(page).toHaveURL(/\/s\/demo-studio\/book/);
  const { time } = await bookViaUi(page, { service: 'Herrenhaarschnitt', barber: 'Alexej', name, phone: '+49 151 2345 6789' });

  await expect(page.getByTestId('booking-status')).toHaveText('Bestätigt');
  await expect(page.getByTestId('booking-barber')).toHaveText('Alexej');
  await expect(page.getByTestId('booking-when')).toContainText(time);
  expect(new URL(page.url()).hash.length).toBeGreaterThan(40); // access token lives in the fragment only

  // Owner side (separate desktop browser context)
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'de-DE', timezoneId: 'Europe/Berlin', serviceWorkers: 'block' });
  const owner = await ctx.newPage();
  await ownerLogin(owner, 'demo-studio', 'owner@demo-studio.test');
  await expect(owner.getByRole('heading', { name: 'Kalender' })).toBeVisible();

  // calendar: week view, page forward until the booking is visible
  await owner.getByRole('radio', { name: 'Woche' }).click();
  let found = false;
  for (let i = 0; i < 8 && !found; i++) {
    found = await owner.getByText(name).first().isVisible().catch(() => false);
    if (!found) {
      await owner.getByRole('button', { name: 'Weiter' }).click();
      await owner.waitForTimeout(400);
    }
  }
  expect(found).toBe(true);
  await owner.getByText(name).first().click();
  await expect(owner.getByTestId('owner-booking-sheet')).toBeVisible();
  await expect(owner.getByTestId('owner-booking-status')).toHaveText('Bestätigt');
  await owner.keyboard.press('Escape');

  // clients: card with visit history
  await owner.goto('/s/demo-studio/owner/clients');
  await owner.getByPlaceholder('Suche nach Name, Telefon oder E-Mail').fill(name);
  await owner.getByText(name).first().click();
  await expect(owner.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(owner.getByText(/Herrenhaarschnitt/).first()).toBeVisible();
  await ctx.close();
});
