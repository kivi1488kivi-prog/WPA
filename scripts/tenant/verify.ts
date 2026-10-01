/**
 * npm run tenant:verify -- <slug> [--strict]
 * Checks that what is LIVE matches business.json: DB rows (service role),
 * public API (anon), real availability, media reachability, isolation and the
 * generated PWA shell. Exit 1 on errors (and on warnings with --strict).
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { adminClient, anonClient, args } from './env.ts';
import { ROOT, loadBusiness, normalize } from './lib.ts';
import { mediaPathsFrom, mediaPlan } from './media.ts';

const { flags, positional } = args();
const slug = positional[0];
if (!slug) {
  console.error('usage: npm run tenant:verify -- <slug> [--strict]');
  process.exit(2);
}
let errors = 0;
let warnings = 0;
const ok = (m: string) => console.log(`  ✓ ${m}`);
const fail = (m: string) => (errors++, console.error(`  ✗ ${m}`));
const warn = (m: string) => (warnings++, console.warn(`  ! ${m}`));

const { biz, dir } = await loadBusiness(slug);
if (!biz) {
  fail('business.json invalid — run tenant:validate');
  process.exit(1);
}
const db = adminClient();
const anon = anonClient();

const st = await db.rpc('pipeline_tenant_state', { p_slug: slug });
type State = {
  tenant: { id: string; name: string; status: string; config_hash: string; owner_overrides: string[]; timezone: string };
  services: { key: string | null; name: string; is_active: boolean; managed_by: string }[];
  barbers: { key: string | null; name: string; is_active: boolean; managed_by: string; services: string[]; weekly_intervals: number }[];
  photos: { key: string | null; path: string; source: string }[];
  go_live_problems: string[];
};
const state = st.data as State | null;
if (st.error || !state) {
  fail(`tenant "${slug}" not found in DB (${st.error?.message ?? 'not published'})`);
  process.exit(1);
}
ok(`tenant exists: ${state.tenant.id} (${state.tenant.status})`);

const plan = await mediaPlan(biz, dir);
const expected = normalize(biz, mediaPathsFrom(plan, `${state.tenant.id}/pipeline/`));
if (state.tenant.config_hash === expected.config_hash) ok(`published config matches business.json (hash ${expected.config_hash})`);
else fail(`DB config hash ${state.tenant.config_hash} != business.json ${expected.config_hash} — run tenant:publish`);
if (state.tenant.owner_overrides.length) warn(`owner edited in cabinet: ${state.tenant.owner_overrides.join(', ')} (kept on republish)`);
if (state.tenant.timezone !== biz.timezone) fail(`timezone ${state.tenant.timezone} != ${biz.timezone}`);

for (const s of biz.services) {
  const row = state.services.find((x) => x.key === s.key);
  if (!row) fail(`service ${s.key} missing in DB`);
  else if (row.managed_by === 'owner') warn(`service ${s.key} is owner-managed (cabinet edits win)`);
  else if (row.is_active !== s.active) fail(`service ${s.key} active=${row.is_active}, expected ${s.active}`);
}
for (const b of biz.barbers) {
  const row = state.barbers.find((x) => x.key === b.key);
  if (!row) fail(`barber ${b.key} missing in DB`);
  else if (row.managed_by === 'owner') warn(`barber ${b.key} is owner-managed (cabinet edits win)`);
  else {
    const want = [...b.services].sort().join(',');
    if (row.services.join(',') !== want) fail(`barber ${b.key} services [${row.services.join(',')}] != [${want}]`);
    if (row.weekly_intervals === 0 && b.active) warn(`barber ${b.key} has no weekly hours`);
  }
}
ok(`${state.services.length} services, ${state.barbers.length} barbers in DB`);

// Public surface as an anonymous visitor.
const pub = await anon.rpc('get_tenant_public', { p_slug: slug });
if (pub.error) fail(`public API failed: ${pub.error.message}`);
else {
  const data = pub.data as { tenant: { id: string; name: string }; services: { id: string; name: string }[]; photos: { path: string }[] };
  if (data.tenant.id !== state.tenant.id) fail('public API returned another tenant');
  else ok(`public page payload OK: "${data.tenant.name}", ${data.services.length} services`);
  let noSlots = 0;
  for (const s of data.services) {
    const d = await anon.rpc('get_available_dates', { p_slug: slug, p_service_id: s.id, p_barber_id: null, p_from: null, p_days: 14 });
    const total = ((d.data as { dates: { slots: number }[] } | null)?.dates ?? []).reduce((a, x) => a + x.slots, 0);
    if (d.error) fail(`availability for ${s.name}: ${d.error.message}`);
    else if (total === 0) (noSlots++, warn(`no free slots in 14 days for "${s.name}"`));
  }
  if (noSlots === 0) ok('every active service has free slots in the next 14 days');
  const base = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
  let bad = 0;
  for (const p of data.photos) {
    const url = p.path.startsWith('/') || p.path.startsWith('http') ? null : `${base}/storage/v1/object/public/tenant-media/${p.path}`;
    if (!url) continue;
    const r = await fetch(url, { method: 'GET' }).catch(() => null);
    if (!r || !r.ok) (bad++, fail(`photo not reachable: ${url} (${r?.status ?? 'network'})`));
  }
  if (bad === 0) ok(`${data.photos.length} photos reachable`);
}

const leak = await anon.from('bookings').select('id').limit(1);
if (!leak.error && (leak.data?.length ?? 0) > 0) fail('anon can read bookings table!');
else ok('anon has no direct table access');

const manifestPath = path.join(ROOT, 'dist/s', slug, 'manifest.webmanifest');
if (!existsSync(manifestPath)) warn('PWA shell not built (run npm run build) — skipped shell checks');
else {
  const m = JSON.parse(await readFile(manifestPath, 'utf8')) as { id: string; scope: string; start_url: string; icons: { src: string; purpose?: string }[]; name: string };
  const want = `/s/${slug}/`;
  if (m.id !== want || m.scope !== want || m.start_url !== want) fail(`manifest id/scope/start_url must be ${want}`);
  else ok('manifest id/scope/start_url are tenant-scoped');
  if (!m.icons.some((i) => i.purpose === 'maskable')) fail('manifest has no maskable icon');
  for (const i of m.icons) if (!existsSync(path.join(ROOT, 'dist', i.src))) fail(`icon missing: ${i.src}`);
  for (const f of ['index.html', 'sw.js', 'apple-touch-icon.png']) if (!existsSync(path.join(ROOT, 'dist/s', slug, f))) fail(`shell file missing: ${f}`);
  const html = await readFile(path.join(ROOT, 'dist/s', slug, 'index.html'), 'utf8');
  if (!html.includes(`/s/${slug}/manifest.webmanifest`)) fail('index.html does not link the tenant manifest');
  else ok('tenant shell (html, sw, icons) present');
}

if (state.tenant.status === 'preview') {
  if (state.go_live_problems.length) warn(`not ready for go-live: ${state.go_live_problems.join(', ')}`);
  else ok('ready for go-live (owner can switch to live in the cabinet)');
}
console.log(`${errors === 0 ? '✓' : '✗'} verify ${slug}: ${errors} error(s), ${warnings} warning(s)`);
process.exit(errors > 0 || (flags.has('--strict') && warnings > 0) ? 1 : 0);
