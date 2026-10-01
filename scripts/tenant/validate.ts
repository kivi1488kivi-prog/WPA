/**
 * npm run tenant:validate -- <slug> | --all
 * Schema + semantic validation of tenants/<slug>/business.json and images.
 * Exit code 1 on any error (warnings do not fail).
 */
import { args } from './env.ts';
import { listTenantSlugs, loadBusiness, printIssues, validateBusiness } from './lib.ts';

export async function validateSlug(slug: string): Promise<boolean> {
  const { biz, dir, issues } = await loadBusiness(slug);
  if (!biz) return printIssues(slug, issues);
  const all = [...issues, ...(await validateBusiness(biz, dir, slug))];
  const ok = printIssues(slug, all);
  if (ok) console.log(`  ✓ [${slug}] valid (${biz.services.length} services, ${biz.barbers.length} barbers, ${biz.photos.length} photos)`);
  return ok;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { flags, positional } = args();
  const slugs = flags.has('--all') ? await listTenantSlugs() : positional;
  if (slugs.length === 0) {
    console.error('usage: npm run tenant:validate -- <slug> | --all');
    process.exit(2);
  }
  let ok = true;
  for (const s of slugs) ok = (await validateSlug(s)) && ok;
  process.exit(ok ? 0 : 1);
}
