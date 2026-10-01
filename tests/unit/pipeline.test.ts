import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { BusinessSchema, type Business } from '../../scripts/tenant/schema.ts';
import { contrast, normalize, validateBusiness, TENANTS_DIR } from '../../scripts/tenant/lib.ts';
import { mediaPathsFrom, mediaPlan } from '../../scripts/tenant/media.ts';

const dir = path.join(TENANTS_DIR, '_template');
async function template(): Promise<Business> {
  const raw = JSON.parse(await readFile(path.join(dir, 'business.json'), 'utf8')) as Record<string, unknown>;
  raw.slug = 'test-shop';
  return BusinessSchema.parse(raw);
}
const errors = async (b: Business) => (await validateBusiness(b, dir, 'test-shop')).filter((i) => i.level === 'error').map((i) => `${i.path}: ${i.message}`);

describe('business.json schema', () => {
  it('template is valid', async () => {
    expect(await errors(await template())).toEqual([]);
  });
  it('rejects unknown keys, bad slugs, bad time ranges and missing Impressum', async () => {
    const raw = JSON.parse(await readFile(path.join(dir, 'business.json'), 'utf8')) as Record<string, unknown>;
    expect(BusinessSchema.safeParse({ ...raw, slug: 'Bad Slug' }).success).toBe(false);
    expect(BusinessSchema.safeParse({ ...raw, unknown_key: 1 }).success).toBe(false);
    expect(BusinessSchema.safeParse({ ...raw, opening_hours: { mon: ['9-17'] } }).success).toBe(false);
    const { legal: _l, ...noLegal } = raw;
    expect(BusinessSchema.safeParse(noLegal).success).toBe(false);
    expect(BusinessSchema.safeParse({ ...raw, locale: 'fr' }).success).toBe(false);
  });
});

describe('semantic validation', () => {
  it('detects references, overlaps, orphan services, timezone and slug mismatch', async () => {
    const b = await template();
    const broken: Business = {
      ...b,
      timezone: 'Mars/Olympus',
      services: [...b.services, { key: 'orphan', name: 'Orphan', duration_min: 30, buffer_min: 0, price: 10, active: true }],
      barbers: [{ ...b.barbers[0]!, services: ['haircut', 'nope'], schedule: { mon: ['10:00-14:00', '13:00-18:00'] } }],
    };
    const e = await errors(broken);
    expect(e.some((x) => x.includes('unknown IANA timezone'))).toBe(true);
    expect(e.some((x) => x.includes('unknown service "nope"'))).toBe(true);
    expect(e.some((x) => x.includes('intervals overlap'))).toBe(true);
    expect(e.some((x) => x.includes('services(orphan)') && x.includes('no active barber'))).toBe(true);
    expect(await validateBusiness(b, dir, 'other-folder')).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'slug' })]));
  });
  it('warns about low accent contrast', async () => {
    const b = await template();
    const issues = await validateBusiness({ ...b, brand: { ...b.brand, accent_color: '#202020' } }, dir, 'test-shop');
    expect(issues.some((i) => i.level === 'warning' && i.path === 'brand.accent_color')).toBe(true);
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 0);
  });
});

describe('normalize', () => {
  it('converts to DB units and is deterministic', async () => {
    const b = await template();
    const plan = await mediaPlan(b, dir);
    const media = mediaPathsFrom(plan, 'tenant/pipeline/');
    const a = normalize(b, media);
    const c = normalize(b, media);
    expect(a.config_hash).toBe(c.config_hash);
    expect(a.services[0]!.price_cents).toBe(3000);
    expect(a.rules.cancel_min_notice_min).toBe(120);
    expect(a.opening_hours[0]).toEqual({ weekday: 1, start_min: 600, end_min: 1140 });
    expect(a.barbers[0]!.breaks[0]).toMatchObject({ weekday: 1, start_min: 780, end_min: 810 });
    expect(a.photos[0]).toMatchObject({ key: 'cover', kind: 'cover' });
    expect(media.cover_path).toMatch(/^tenant\/pipeline\/cover-[0-9a-f]{10}\.jpg$/);
    expect(normalize({ ...b, services: [{ ...b.services[0]!, price: 31 }] }, media).config_hash).not.toBe(a.config_hash);
  });
});
