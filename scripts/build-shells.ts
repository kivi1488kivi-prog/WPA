/**
 * npm run build:shells — runs after `vite build`.
 *
 * The JS/CSS bundle is shared by every tenant. For each tenants/<slug>/ this
 * emits a tenant-specific shell so installs, deep links and share previews
 * are correct per barbershop:
 *   dist/s/<slug>/index.html            title, description, theme-color, lang,
 *                                       manifest, icons, iOS startup images
 *   dist/s/<slug>/manifest.webmanifest  id/start_url/scope = /s/<slug>/
 *   dist/s/<slug>/owner/{index.html,manifest.webmanifest,sw.js}  cabinet PWA
 *   dist/s/<slug>/sw.js                 copy of the shared worker (own scope)
 *   dist/s/<slug>/icons/*, apple-touch-icon.png, startup/*, media/*
 * plus Cloudflare Pages `_redirects` (deep links -> right shell) and `_headers`.
 * Old tenants keep working as long as their folder stays in tenants/.
 */
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { ROOT, listTenantSlugs, loadBusiness, printIssues, validateBusiness } from './tenant/lib.ts';
import { mediaPlan } from './tenant/media.ts';
import type { Business } from './tenant/schema.ts';

const DIST = path.join(ROOT, 'dist');
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// iPhone portrait splash sizes (device px, css px, dpr)
const STARTUP = [
  { w: 1290, h: 2796, cw: 430, ch: 932, r: 3 },
  { w: 1179, h: 2556, cw: 393, ch: 852, r: 3 },
  { w: 1170, h: 2532, cw: 390, ch: 844, r: 3 },
  { w: 1284, h: 2778, cw: 428, ch: 926, r: 3 },
  { w: 750, h: 1334, cw: 375, ch: 667, r: 2 },
];

async function icons(biz: Business, dir: string, out: string) {
  const src = path.join(dir, biz.brand.icon);
  const bg = biz.brand.background_color;
  await mkdir(path.join(out, 'icons'), { recursive: true });
  await sharp(src).resize(192, 192).png().toFile(path.join(out, 'icons/icon-192.png'));
  await sharp(src).resize(512, 512).png().toFile(path.join(out, 'icons/icon-512.png'));
  await sharp(src).resize(32, 32).png().toFile(path.join(out, 'icons/favicon-32.png'));
  // Maskable: provided art, or the icon shrunk into the 80% safe zone on the brand background.
  if (biz.brand.maskable_icon) {
    await sharp(path.join(dir, biz.brand.maskable_icon)).resize(512, 512).png().toFile(path.join(out, 'icons/icon-maskable-512.png'));
  } else {
    const inner = await sharp(src).resize(360, 360).png().toBuffer();
    await sharp({ create: { width: 512, height: 512, channels: 4, background: bg } })
      .composite([{ input: inner, gravity: 'center' }])
      .png()
      .toFile(path.join(out, 'icons/icon-maskable-512.png'));
  }
  // iOS ignores transparency: flatten on the brand background.
  await sharp(src).resize(180, 180).flatten({ background: bg }).png().toFile(path.join(out, 'apple-touch-icon.png'));
  await mkdir(path.join(out, 'startup'), { recursive: true });
  const logo = await sharp(src).resize(240, 240).png().toBuffer();
  for (const s of STARTUP) {
    await sharp({ create: { width: s.w, height: s.h, channels: 3, background: bg } })
      .composite([{ input: logo, gravity: 'center' }])
      .png({ compressionLevel: 9 })
      .toFile(path.join(out, `startup/${s.w}x${s.h}.png`));
  }
}

function manifest(biz: Business, area: 'client' | 'owner') {
  const base = `/s/${biz.slug}/`;
  const scope = area === 'owner' ? `${base}owner/` : base;
  return {
    id: scope,
    name: area === 'owner' ? `${biz.short_name} · Cabinet` : biz.name,
    short_name: area === 'owner' ? `${biz.short_name} ⚙` : biz.short_name,
    description: biz.tagline ?? biz.name,
    lang: biz.locale,
    dir: 'ltr',
    start_url: scope,
    scope,
    display: 'standalone',
    orientation: 'portrait',
    background_color: biz.brand.background_color,
    theme_color: biz.brand.background_color,
    categories: ['lifestyle', 'business'],
    icons: [
      { src: `${base}icons/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${base}icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `${base}icons/icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

function head(biz: Business, area: 'client' | 'owner', coverUrl: string | null): string {
  const base = `/s/${biz.slug}/`;
  const scope = area === 'owner' ? `${base}owner/` : base;
  const title = area === 'owner' ? `${biz.short_name} · Cabinet` : biz.name;
  const desc = biz.tagline ?? biz.name;
  const tags = [
    `<meta name="description" content="${escapeHtml(desc)}" />`,
    `<meta name="theme-color" content="${biz.brand.background_color}" />`,
    `<meta name="tenant-slug" content="${biz.slug}" />`,
    `<link rel="manifest" href="${scope}manifest.webmanifest" />`,
    `<link rel="icon" type="image/png" sizes="32x32" href="${base}icons/favicon-32.png" />`,
    `<link rel="apple-touch-icon" href="${base}apple-touch-icon.png" />`,
    `<meta name="apple-mobile-web-app-capable" content="yes" />`,
    `<meta name="mobile-web-app-capable" content="yes" />`,
    `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />`,
    `<meta name="apple-mobile-web-app-title" content="${escapeHtml(biz.short_name)}" />`,
    ...STARTUP.map(
      (s) =>
        `<link rel="apple-touch-startup-image" href="${base}startup/${s.w}x${s.h}.png" media="(device-width: ${s.cw}px) and (device-height: ${s.ch}px) and (-webkit-device-pixel-ratio: ${s.r}) and (orientation: portrait)" />`,
    ),
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(desc)}" />`,
    ...(coverUrl ? [`<meta property="og:image" content="${coverUrl}" />`] : []),
    area === 'owner' ? '<meta name="robots" content="noindex, nofollow" />' : '',
    `<style>html,body{background:${biz.brand.background_color};color-scheme:dark}</style>`,
  ];
  return tags.filter(Boolean).join('\n    ');
}

async function main() {
  const templatePath = path.join(DIST, 'index.html');
  if (!existsSync(templatePath)) throw new Error('dist/index.html missing — run `vite build` first');
  const template = await readFile(templatePath, 'utf8');
  const swSrc = path.join(DIST, 'sw.js');
  if (!existsSync(swSrc)) throw new Error('dist/sw.js missing — vite-plugin-pwa injectManifest did not run');

  const slugs = await listTenantSlugs();
  for (const slug of slugs) {
    const { biz, dir, issues } = await loadBusiness(slug);
    if (!biz) {
      printIssues(slug, issues);
      throw new Error(`invalid tenant ${slug}`);
    }
    if (!printIssues(slug, await validateBusiness(biz, dir, slug))) throw new Error(`invalid tenant ${slug}`);
    const out = path.join(DIST, 's', slug);
    await mkdir(path.join(out, 'owner'), { recursive: true });
    await mkdir(path.join(out, 'media'), { recursive: true });

    await icons(biz, dir, out);
    const plan = await mediaPlan(biz, dir);
    for (const item of plan) await writeFile(path.join(out, 'media', item.name), await item.render());
    const cover = plan.find((i) => i.role === 'cover');
    const coverUrl = cover ? `/s/${slug}/media/${cover.name}` : null;

    for (const area of ['client', 'owner'] as const) {
      const target = area === 'owner' ? path.join(out, 'owner') : out;
      const html = template
        .replace(/<html lang="[^"]*"/, `<html lang="${biz.locale}"`)
        .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(area === 'owner' ? `${biz.short_name} · Cabinet` : biz.name)}</title>`)
        .replace('<!--TENANT_HEAD-->', head(biz, area, coverUrl));
      await writeFile(path.join(target, 'index.html'), html);
      await writeFile(path.join(target, 'manifest.webmanifest'), JSON.stringify(manifest(biz, area), null, 2));
      await copyFile(swSrc, path.join(target, 'sw.js'));
      if (existsSync(`${swSrc}.map`)) await copyFile(`${swSrc}.map`, path.join(target, 'sw.js.map'));
    }
    console.log(`  ✓ shell /s/${slug}/ (+ owner) — ${plan.length} media, ${STARTUP.length} startup images`);
  }

  // Cloudflare Pages: deep links of every tenant resolve to that tenant's shell.
  await writeFile(
    path.join(DIST, '_redirects'),
    ['/s/:slug/owner/* /s/:slug/owner/index.html 200', '/s/:slug/owner /s/:slug/owner/ 301', '/s/:slug /s/:slug/ 301', '/s/:slug/* /s/:slug/index.html 200', ''].join('\n'),
  );
  const supabase = process.env.VITE_SUPABASE_URL ?? '';
  const functions = process.env.VITE_FUNCTIONS_URL ?? '';
  const connect = ["'self'", supabase, functions].filter(Boolean).join(' ');
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${supabase}`.trim(),
    `connect-src ${connect}`,
    "font-src 'self' data:",
    "manifest-src 'self'",
    "worker-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  await writeFile(
    path.join(DIST, '_headers'),
    [
      '/*',
      '  X-Content-Type-Options: nosniff',
      '  Referrer-Policy: no-referrer',
      '  X-Frame-Options: DENY',
      '  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()',
      `  Content-Security-Policy: ${csp}`,
      '/assets/*',
      '  Cache-Control: public, max-age=31536000, immutable',
      '/s/*/media/*',
      '  Cache-Control: public, max-age=31536000, immutable',
      '/s/*/sw.js',
      '  Cache-Control: no-cache',
      '/s/*/owner/sw.js',
      '  Cache-Control: no-cache',
      '/s/*/index.html',
      '  Cache-Control: no-cache',
      '/s/*/manifest.webmanifest',
      '  Cache-Control: no-cache',
      '',
    ].join('\n'),
  );
  await copyFile(templatePath, path.join(DIST, '404.html'));
  console.log(`✓ ${slugs.length} tenant shells, _redirects, _headers`);
}

await main();
