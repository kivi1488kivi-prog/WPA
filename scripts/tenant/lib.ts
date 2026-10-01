import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { BusinessSchema, WEEKDAYS, parseRange, weekToIntervals, type Business } from './schema.ts';

export const ROOT = path.resolve(import.meta.dirname, '../..');
export const TENANTS_DIR = path.join(ROOT, 'tenants');

export interface Issue { level: 'error' | 'warning'; path: string; message: string }

export async function listTenantSlugs(): Promise<string[]> {
  const entries = await readdir(TENANTS_DIR, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('_') && existsSync(path.join(TENANTS_DIR, e.name, 'business.json')))
    .map((e) => e.name)
    .sort();
}

export async function loadBusiness(slug: string): Promise<{ biz: Business | null; dir: string; issues: Issue[] }> {
  const dir = path.join(TENANTS_DIR, slug);
  const file = path.join(dir, 'business.json');
  if (!existsSync(file)) return { biz: null, dir, issues: [{ level: 'error', path: file, message: 'business.json not found' }] };
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    return { biz: null, dir, issues: [{ level: 'error', path: 'business.json', message: `invalid JSON: ${(e as Error).message}` }] };
  }
  const parsed = BusinessSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      biz: null,
      dir,
      issues: parsed.error.issues.map((i) => ({ level: 'error' as const, path: i.path.join('.') || '(root)', message: i.message })),
    };
  }
  return { biz: parsed.data, dir, issues: [] };
}

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
export function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

function overlaps(list: { start_min: number; end_min: number }[]): boolean {
  const s = [...list].sort((a, b) => a.start_min - b.start_min);
  for (let i = 1; i < s.length; i++) if (s[i]!.start_min < s[i - 1]!.end_min) return true;
  return false;
}

async function checkImage(dir: string, rel: string, p: string, opts: { minWidth?: number; square?: boolean; minSize?: number }): Promise<Issue[]> {
  const file = path.join(dir, rel);
  if (!existsSync(file)) return [{ level: 'error', path: p, message: `image not found: ${rel}` }];
  try {
    const m = await sharp(file).metadata();
    const out: Issue[] = [];
    if (opts.square && m.width !== m.height) out.push({ level: 'error', path: p, message: `icon must be square (got ${m.width}x${m.height})` });
    if (opts.minSize && (m.width ?? 0) < opts.minSize) out.push({ level: 'error', path: p, message: `icon must be at least ${opts.minSize}px (got ${m.width})` });
    if (opts.minWidth && (m.width ?? 0) < opts.minWidth) out.push({ level: 'warning', path: p, message: `image is narrow (${m.width}px < ${opts.minWidth}px), may look blurry` });
    return out;
  } catch (e) {
    return [{ level: 'error', path: p, message: `unreadable image ${rel}: ${(e as Error).message}` }];
  }
}

/** Semantic validation on top of the schema: references, schedules, assets, contrast. */
export async function validateBusiness(biz: Business, dir: string, folderSlug: string): Promise<Issue[]> {
  const issues: Issue[] = [];
  const err = (p: string, message: string) => issues.push({ level: 'error', path: p, message });
  const warn = (p: string, message: string) => issues.push({ level: 'warning', path: p, message });

  if (biz.slug !== folderSlug) err('slug', `slug "${biz.slug}" must equal folder name "${folderSlug}"`);
  try {
    new Intl.DateTimeFormat('en', { timeZone: biz.timezone });
  } catch {
    err('timezone', `unknown IANA timezone "${biz.timezone}"`);
  }

  const dup = (arr: string[], p: string) => {
    const seen = new Set<string>();
    for (const k of arr) {
      if (seen.has(k)) err(p, `duplicate key "${k}"`);
      seen.add(k);
    }
  };
  dup(biz.services.map((s) => s.key), 'services');
  dup(biz.barbers.map((b) => b.key), 'barbers');
  dup(biz.photos.map((p) => p.key), 'photos');

  const serviceKeys = new Set(biz.services.map((s) => s.key));
  const barberKeys = new Set(biz.barbers.map((b) => b.key));
  const step = biz.rules.slot_step_min;

  const checkWeek = (week: Business['opening_hours'], p: string) => {
    for (const d of WEEKDAYS) {
      const list = (week[d] ?? []).map(parseRange);
      list.forEach((r, i) => {
        if (r.start_min >= r.end_min) err(`${p}.${d}[${i}]`, 'start must be before end');
        if (r.start_min % step !== 0 || r.end_min % step !== 0) warn(`${p}.${d}[${i}]`, `not aligned to slot step ${step} min`);
      });
      if (overlaps(list)) err(`${p}.${d}`, 'intervals overlap');
    }
  };
  checkWeek(biz.opening_hours, 'opening_hours');

  biz.barbers.forEach((b, i) => {
    const p = `barbers[${i}](${b.key})`;
    for (const s of b.services) if (!serviceKeys.has(s)) err(`${p}.services`, `unknown service "${s}"`);
    checkWeek(b.schedule, `${p}.schedule`);
    checkWeek(b.breaks, `${p}.breaks`);
    if (Object.values(b.schedule).every((v) => !v || v.length === 0)) warn(`${p}.schedule`, 'barber has no working hours');
    for (const d of WEEKDAYS) {
      const work = (b.schedule[d] ?? []).map(parseRange);
      const open = (biz.opening_hours[d] ?? []).map(parseRange);
      for (const w of work) {
        if (!open.some((o) => o.start_min <= w.start_min && o.end_min >= w.end_min)) {
          warn(`${p}.schedule.${d}`, 'working interval is outside shop opening hours');
        }
      }
      for (const br of (b.breaks[d] ?? []).map(parseRange)) {
        if (!work.some((w) => w.start_min <= br.start_min && w.end_min >= br.end_min)) warn(`${p}.breaks.${d}`, 'break is outside working hours');
      }
    }
  });

  for (const s of biz.services.filter((x) => x.active)) {
    if (!biz.barbers.some((b) => b.active && b.services.includes(s.key))) err(`services(${s.key})`, 'active service has no active barber');
  }
  biz.special_dates.forEach((sd, i) => {
    if (sd.barber && !barberKeys.has(sd.barber)) err(`special_dates[${i}]`, `unknown barber "${sd.barber}"`);
    if (!sd.closed && sd.hours.length === 0) err(`special_dates[${i}]`, 'either closed=true or hours must be set');
    if (overlaps(sd.hours.map(parseRange))) err(`special_dates[${i}]`, 'intervals overlap');
  });
  if (biz.demo?.bookings.length && !biz.is_demo) err('demo', 'demo bookings are allowed only when is_demo = true');
  biz.demo?.bookings.forEach((d, i) => {
    if (!serviceKeys.has(d.service)) err(`demo.bookings[${i}]`, `unknown service "${d.service}"`);
    if (d.barber && !barberKeys.has(d.barber)) err(`demo.bookings[${i}]`, `unknown barber "${d.barber}"`);
  });

  const bg = biz.brand.background_color;
  const c = contrast(biz.brand.accent_color, bg);
  if (c < 3) warn('brand.accent_color', `low contrast against background (${c.toFixed(2)}:1 < 3:1); buttons may be hard to see`);

  issues.push(...(await checkImage(dir, biz.brand.icon, 'brand.icon', { square: true, minSize: 512 })));
  if (biz.brand.maskable_icon) issues.push(...(await checkImage(dir, biz.brand.maskable_icon, 'brand.maskable_icon', { square: true, minSize: 512 })));
  if (biz.brand.logo) issues.push(...(await checkImage(dir, biz.brand.logo, 'brand.logo', { minWidth: 128 })));
  issues.push(...(await checkImage(dir, biz.brand.cover, 'brand.cover', { minWidth: 1200 })));
  for (const [i, ph] of biz.photos.entries()) issues.push(...(await checkImage(dir, ph.file, `photos[${i}]`, { minWidth: 800 })));
  for (const [i, b] of biz.barbers.entries()) if (b.photo) issues.push(...(await checkImage(dir, b.photo, `barbers[${i}].photo`, { minWidth: 300 })));

  return issues;
}

export interface MediaPaths {
  logo_path?: string;
  cover_path: string;
  photos: Record<string, string>;
  barbers: Record<string, string>;
}

/** business.json -> config payload for public.pipeline_publish_tenant(). */
export function normalize(biz: Business, media: MediaPaths) {
  const toCents = (p: number) => Math.round(p * 100);
  const h = (x: number | undefined) => (x === undefined ? undefined : Math.round(x * 60));
  const config = {
    slug: biz.slug,
    name: biz.name,
    short_name: biz.short_name,
    tagline: biz.tagline ?? null,
    description: biz.description ?? null,
    locale: biz.locale,
    timezone: biz.timezone,
    currency: biz.currency,
    accent_color: biz.brand.accent_color,
    is_demo: biz.is_demo,
    contact: { phone: biz.contact.phone, email: biz.contact.email ?? null, instagram: biz.contact.instagram ?? null, website: biz.contact.website ?? null },
    location: {
      address_line: biz.location.address_line,
      city: biz.location.city,
      postal_code: biz.location.postal_code ?? null,
      country: biz.location.country ?? null,
      lat: biz.location.lat ?? null,
      lng: biz.location.lng ?? null,
      map_url: biz.location.map_url ?? null,
    },
    branding: { logo_path: media.logo_path ?? null, cover_path: media.cover_path },
    rules: {
      slot_step_min: biz.rules.slot_step_min,
      min_lead_min: biz.rules.min_lead_min,
      max_advance_days: biz.rules.max_advance_days,
      allow_self_cancel: biz.rules.cancellation.allowed,
      cancel_min_notice_min: h(biz.rules.cancellation.min_notice_hours),
      allow_self_reschedule: biz.rules.reschedule.allowed,
      reschedule_min_notice_min: h(biz.rules.reschedule.min_notice_hours),
      max_self_reschedules: biz.rules.reschedule.max_per_booking,
    },
    notifications: { reminder_offsets_min: biz.notifications.reminders_before_min, notify_staff: biz.notifications.notify_staff },
    ai: biz.ai,
    legal: biz.legal,
    opening_hours: weekToIntervals(biz.opening_hours),
    services: biz.services.map((s, i) => ({
      key: s.key,
      name: s.name,
      description: s.description ?? null,
      duration_min: s.duration_min,
      buffer_min: s.buffer_min,
      price_cents: toCents(s.price),
      active: s.active,
      sort_order: i,
      policy: s.policy
        ? {
            allow_self_cancel: s.policy.cancellation_allowed ?? null,
            cancel_min_notice_min: h(s.policy.cancellation_min_notice_hours) ?? null,
            allow_self_reschedule: s.policy.reschedule_allowed ?? null,
            reschedule_min_notice_min: h(s.policy.reschedule_min_notice_hours) ?? null,
          }
        : null,
    })),
    barbers: biz.barbers.map((b, i) => ({
      key: b.key,
      name: b.name,
      title: b.title ?? null,
      bio: b.bio ?? null,
      photo_path: media.barbers[b.key] ?? null,
      specialties: b.specialties,
      color: b.color,
      marker: b.marker,
      active: b.active,
      sort_order: i,
      services: b.services,
      hours: weekToIntervals(b.schedule),
      breaks: weekToIntervals(b.breaks, true),
    })),
    photos: [
      { key: 'cover', kind: 'cover', path: media.cover_path, alt: biz.name, sort_order: 0 },
      ...biz.photos.map((p, i) => ({ key: p.key, kind: p.kind, path: media.photos[p.key] ?? '', alt: p.alt, sort_order: i + 1 })),
    ],
    special_dates: biz.special_dates.map((sd) => ({
      date: sd.date,
      barber: sd.barber,
      closed: sd.closed,
      note: sd.note,
      intervals: sd.hours.map(parseRange),
    })),
  };
  // Media files are content-addressed; hash only their file names so a seeded
  // DB (static /s/<slug>/media/ URLs) and a published one (Storage URLs) of the
  // same business.json get the same hash.
  const stable = JSON.stringify(config, (k, v: unknown) =>
    typeof v === 'string' && (k === 'path' || k.endsWith('_path')) ? v.slice(v.lastIndexOf('/') + 1) : v);
  const config_hash = createHash('sha256').update(stable).digest('hex').slice(0, 16);
  return { ...config, config_hash };
}

export type NormalizedConfig = ReturnType<typeof normalize>;

export function printIssues(slug: string, issues: Issue[]): boolean {
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');
  for (const i of errors) console.error(`  ✗ [${slug}] ${i.path}: ${i.message}`);
  for (const i of warnings) console.warn(`  ! [${slug}] ${i.path}: ${i.message}`);
  return errors.length === 0;
}
