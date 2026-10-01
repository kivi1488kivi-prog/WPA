import { expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

export function envLocal(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of fs.readFileSync(path.resolve(import.meta.dirname, '../.env.local'), 'utf8').split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(l);
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

export async function rpc<T = unknown>(fn: string, args: Record<string, unknown>, key = envLocal().SUPABASE_ANON_KEY!): Promise<T> {
  const e = envLocal();
  const res = await fetch(`${e.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: key, authorization: `Bearer ${key}`, 'x-forwarded-for': `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
    body: JSON.stringify(args),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${fn}: ${JSON.stringify(body)}`);
  return body as T;
}

export const uniq = () => Math.random().toString(36).slice(2, 7).toUpperCase();

/** Book through the UI: sequential sheets service → barber → date/time → details. */
export async function bookViaUi(page: Page, opts: { service: string; barber: string | null; name: string; phone: string }) {
  await expect(page.getByTestId('sheet-service')).toBeVisible();
  await page.getByTestId('sheet-service').getByText(opts.service, { exact: true }).click();
  await expect(page.getByTestId('sheet-barber')).toBeVisible();
  if (opts.barber) await page.getByTestId('sheet-barber').getByText(opts.barber, { exact: true }).click();
  else await page.getByTestId('barber-any').click();
  return pickSlotAndConfirm(page, opts);
}

export async function pickSlotAndConfirm(page: Page, opts: { name: string; phone: string }) {
  const sheet = page.getByTestId('sheet-time');
  await expect(sheet).toBeVisible();
  const slot = sheet.locator('[data-slot-time]').first();
  await expect(slot).toBeVisible();
  const time = (await slot.getAttribute('data-slot-time'))!;
  await slot.click();
  const details = page.getByTestId('sheet-details');
  await expect(details).toBeVisible();
  await details.getByLabel('Name').fill(opts.name);
  await details.getByTestId('phone-input').fill(opts.phone);
  await page.getByTestId('confirm-booking').click();
  await expect(page.getByRole('heading', { name: 'Ihr Termin ist gebucht!' })).toBeVisible();
  return { time };
}

export async function ownerLogin(page: Page, slug: string, email: string) {
  await page.goto(`/s/${slug}/owner/`);
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort').fill('demo-password-123');
  await page.getByRole('button', { name: 'Anmelden' }).click();
}
