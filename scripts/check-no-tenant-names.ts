/**
 * npm run lint:tenants — fails if any tenant-specific value (name, short name,
 * slug, phone, barber names) from tenants/<slug>/business.json appears in
 * src/. Re-skinning must never require source changes.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, listTenantSlugs, loadBusiness } from './tenant/lib.ts';

async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await files(p)));
    else if (/\.(tsx?|css|html|json)$/.test(e.name)) out.push(p);
  }
  return out;
}

const needles = new Map<string, string>();
for (const slug of await listTenantSlugs()) {
  const { biz } = await loadBusiness(slug);
  if (!biz) continue;
  const add = (v: string | undefined, what: string) => v && v.length >= 4 && needles.set(v.toLowerCase(), `${slug}:${what}`);
  add(biz.slug, 'slug');
  add(biz.name, 'name');
  add(biz.short_name, 'short_name');
  add(biz.contact.phone, 'phone');
  add(biz.contact.email, 'email');
  add(biz.location.address_line, 'address');
  biz.barbers.forEach((b) => add(b.name.length >= 5 ? b.name : undefined, `barber ${b.key}`));
}
let bad = 0;
const srcFiles = [...(await files(path.join(ROOT, 'src'))), path.join(ROOT, 'index.html')];
for (const f of srcFiles) {
  const text = (await readFile(f, 'utf8')).toLowerCase();
  for (const [needle, origin] of needles) {
    if (text.includes(needle)) {
      bad++;
      console.error(`✗ ${path.relative(ROOT, f)} contains tenant value "${needle}" (${origin})`);
    }
  }
}
console.log(bad === 0 ? `✓ no tenant-specific values in src/ (${needles.size} values checked in ${srcFiles.length} files)` : `✗ ${bad} occurrence(s)`);
process.exit(bad === 0 ? 0 : 1);
