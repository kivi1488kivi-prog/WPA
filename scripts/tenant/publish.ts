/**
 * npm run tenant:publish -- <slug> [--force] [--prune] [--seed-demo] [--dry-run]
 *
 * business.json + images -> Supabase (DB is the runtime source of truth):
 *  1. validate; 2. ensure tenant row; 3. upload content-addressed media to
 *  Storage (tenant-media/<tenant_id>/pipeline/...); 4. atomic SQL publish.
 * Republishing never deletes bookings, customers, owner-created barbers or
 * owner-uploaded photos. Entities edited in the cabinet are skipped unless
 * --force. --prune deactivates pipeline entities removed from the file.
 */
import { adminClient, args } from './env.ts';
import { loadBusiness, normalize } from './lib.ts';
import { mediaPathsFrom, mediaPlan } from './media.ts';
import { validateSlug } from './validate.ts';

const BUCKET = 'tenant-media';
const { flags, positional } = args();
const slug = positional[0];
if (!slug) {
  console.error('usage: npm run tenant:publish -- <slug> [--force] [--prune] [--seed-demo] [--dry-run]');
  process.exit(2);
}

if (!(await validateSlug(slug))) process.exit(1);
const { biz, dir } = await loadBusiness(slug);
if (!biz) process.exit(1);
const plan = await mediaPlan(biz, dir);

if (flags.has('--dry-run')) {
  const cfg = normalize(biz, mediaPathsFrom(plan, '<tenant_id>/pipeline/'));
  console.log(JSON.stringify(cfg, null, 2));
  process.exit(0);
}

const db = adminClient();
const ensured = await db.rpc('pipeline_ensure_tenant', {
  p_slug: biz.slug, p_name: biz.name, p_short_name: biz.short_name, p_timezone: biz.timezone,
  p_currency: biz.currency, p_accent: biz.brand.accent_color, p_locale: biz.locale, p_is_demo: biz.is_demo,
});
if (ensured.error) {
  console.error('✗ ensure tenant failed:', ensured.error.message);
  process.exit(1);
}
const tenantId = ensured.data as string;
const prefix = `${tenantId}/pipeline/`;

let uploaded = 0;
let reused = 0;
for (const item of plan) {
  const body = await item.render();
  const res = await db.storage.from(BUCKET).upload(`${prefix}${item.name}`, body, { contentType: item.contentType, upsert: false, cacheControl: '31536000' });
  if (res.error) {
    const msg = res.error.message ?? '';
    if (/exist|duplicate/i.test(msg) || (res.error as { statusCode?: string }).statusCode === '409') reused++;
    else {
      console.error(`✗ upload ${item.name}: ${msg}`);
      process.exit(1);
    }
  } else uploaded++;
}

const config = normalize(biz, mediaPathsFrom(plan, prefix));
const pub = await db.rpc('pipeline_publish_tenant', { p_config: config, p_force: flags.has('--force'), p_prune: flags.has('--prune') });
if (pub.error) {
  console.error('✗ publish failed:', pub.error.message, pub.error.details ?? '');
  process.exit(1);
}
const report = pub.data as Record<string, unknown>;
console.log(`✓ published ${slug} → tenant ${tenantId} (config v${String(report.config_version)}, status ${String(report.status)})`);
console.log(`  media: ${uploaded} uploaded, ${reused} unchanged`);
console.log(`  report: ${JSON.stringify({ services: report.services, barbers: report.barbers, photos: report.photos, sections_skipped: report.sections_skipped })}`);

if (flags.has('--seed-demo') && biz.demo?.bookings.length) {
  const state = await db.rpc('pipeline_tenant_state', { p_slug: slug });
  const counts = (state.data as { counts: { bookings: number } } | null)?.counts;
  if (counts && counts.bookings > 0) console.log('  demo bookings: skipped (tenant already has bookings)');
  else {
    const seeded = await db.rpc('pipeline_seed_demo_bookings', { p_slug: slug, p_items: biz.demo.bookings });
    if (seeded.error) console.error('  ! demo bookings failed:', seeded.error.message);
    else console.log(`  demo bookings: ${String(seeded.data)} created`);
  }
}
console.log(`Next: npm run tenant:verify -- ${slug}`);
