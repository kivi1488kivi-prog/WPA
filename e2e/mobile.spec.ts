import { expect, test } from '@playwright/test';
import { pickSlotAndConfirm, rpc, uniq } from './helpers';

test('mobile: deep link → barber → date → time → details → confirm → open by token on another device → cancel', async ({ page, browser }) => {
  const shop = await rpc<{ services: { id: string; name: string }[] }>('get_tenant_public', { p_slug: 'demo-studio' });
  const fade = shop.services.find((s) => s.name === 'Fade')!;

  // deep link straight into the flow with the service preselected
  await page.goto(`/s/demo-studio/book?service=${fade.id}`);
  await expect(page.getByTestId('sheet-barber')).toBeVisible();
  await page.getByTestId('barber-any').click();
  await expect(page.getByTestId('sheet-time')).toBeVisible();

  // hardware/browser Back steps back through the sheets
  await page.goBack();
  await expect(page.getByTestId('sheet-barber')).toBeVisible();
  await page.goForward();
  await expect(page.getByTestId('sheet-time')).toBeVisible();

  // choose a later date in the strip
  const dates = page.getByTestId('date-strip').locator('[role=option]');
  await dates.nth(1).click();
  await expect(dates.nth(1)).toHaveAttribute('aria-selected', 'true');

  const name = `Mobil ${uniq()}`;
  const { time } = await pickSlotAndConfirm(page, { name, phone: '+49 151 7777 8888' });
  await expect(page.getByTestId('booking-when')).toContainText(time);
  const link = page.url();

  // "My visits" lists it on this device
  await page.getByRole('link', { name: 'Meine Termine' }).click();
  await expect(page.getByText(/Fade/).first()).toBeVisible();

  // another device opens the link from the confirmation
  const other = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'de-DE', serviceWorkers: 'block' });
  const p2 = await other.newPage();
  await p2.goto(link);
  await expect(p2.getByTestId('booking-status')).toHaveText('Bestätigt');
  await p2.getByTestId('cancel-btn').click();
  await p2.getByRole('button', { name: 'Termin stornieren' }).last().click();
  await expect(p2.getByTestId('booking-status')).toHaveText('Storniert');
  await other.close();

  await page.reload();
  await expect(page.getByTestId('booking-status')).toHaveText('Storniert');
});
