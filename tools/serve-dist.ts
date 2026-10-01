/**
 * Static server for dist/ that applies the same rewrite rules as the generated
 * Cloudflare Pages `_redirects` (so E2E tests exercise real deep links and
 * per-tenant shells) and the `Cache-Control` rules for service workers.
 * Usage: tsx tools/serve-dist.ts [port]
 */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../dist');
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 4173);
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.map': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

async function fileFor(p: string): Promise<string | null> {
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT)) return null;
  try {
    const s = await stat(f);
    if (s.isFile()) return f;
    if (s.isDirectory()) {
      const idx = path.join(f, 'index.html');
      if ((await stat(idx).catch(() => null))?.isFile()) return idx;
    }
  } catch {
    /* not found */
  }
  return null;
}

function rewrite(p: string): string | null {
  let m = /^\/s\/([^/]+)\/owner(\/.*)?$/.exec(p);
  if (m) return `/s/${m[1]}/owner/index.html`;
  m = /^\/s\/([^/]+)(\/.*)?$/.exec(p);
  if (m) return `/s/${m[1]}/index.html`;
  return null;
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const p = decodeURIComponent(url.pathname);
    if (/^\/s\/[^/]+$/.test(p) || /^\/s\/[^/]+\/owner$/.test(p)) {
      res.writeHead(301, { location: `${p}/${url.search}` });
      return res.end();
    }
    let file = await fileFor(p);
    let status = 200;
    if (!file) {
      const r = rewrite(p);
      file = r ? await fileFor(r) : null;
      if (!file) {
        file = path.join(ROOT, '404.html');
        status = 404;
      }
    }
    const ext = path.extname(file);
    const headers: Record<string, string> = { 'content-type': TYPES[ext] ?? 'application/octet-stream' };
    if (file.endsWith('sw.js') || ext === '.html' || ext === '.webmanifest') headers['cache-control'] = 'no-cache';
    else if (p.startsWith('/assets/') || p.includes('/media/')) headers['cache-control'] = 'public, max-age=31536000, immutable';
    res.writeHead(status, headers);
    res.end(await readFile(file));
  })
  .listen(PORT, () => console.log(`[serve-dist] http://localhost:${PORT}`));
