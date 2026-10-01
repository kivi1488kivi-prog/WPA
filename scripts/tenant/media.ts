import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { Business } from './schema.ts';

export interface MediaItem {
  role: string; // cover | logo | photo:<key> | barber:<key>
  name: string; // content-addressed file name, e.g. cover-1a2b3c4d.jpg
  contentType: string;
  render: () => Promise<Buffer>;
}

const SPEC_VERSION = 'v1';

async function hashed(dir: string, rel: string, spec: string): Promise<string> {
  const buf = await readFile(path.join(dir, rel));
  return createHash('sha256').update(buf).update(spec).update(SPEC_VERSION).digest('hex').slice(0, 10);
}

/**
 * Web derivatives of the tenant images. File names are content-addressed
 * (source bytes + transform spec), so they are immutable and cache-friendly,
 * and the same names are produced by publish (Storage) and build:shells (static).
 */
export async function mediaPlan(biz: Business, dir: string): Promise<MediaItem[]> {
  const items: MediaItem[] = [];
  const jpeg = (rel: string, role: string, base: string, width: number, height?: number) => async () => {
    const spec = `${width}x${height ?? 0}`;
    const h = await hashed(dir, rel, spec);
    items.push({
      role,
      name: `${base}-${h}.jpg`,
      contentType: 'image/jpeg',
      render: () =>
        sharp(path.join(dir, rel))
          .rotate()
          .resize(width, height, { fit: height ? 'cover' : 'inside', position: 'attention', withoutEnlargement: !height })
          .jpeg({ quality: 78, mozjpeg: true, progressive: true })
          .toBuffer(),
    });
  };
  const tasks: (() => Promise<void>)[] = [];
  tasks.push(jpeg(biz.brand.cover, 'cover', 'cover', 1600));
  for (const p of biz.photos) tasks.push(jpeg(p.file, `photo:${p.key}`, `photo-${p.key}`, 1400));
  for (const b of biz.barbers) if (b.photo) tasks.push(jpeg(b.photo, `barber:${b.key}`, `barber-${b.key}`, 600, 600));
  if (biz.brand.logo) {
    const rel = biz.brand.logo;
    tasks.push(async () => {
      const h = await hashed(dir, rel, 'logo256');
      items.push({
        role: 'logo',
        name: `logo-${h}.png`,
        contentType: 'image/png',
        render: () => sharp(path.join(dir, rel)).resize(256, 256, { fit: 'inside' }).png().toBuffer(),
      });
    });
  }
  for (const t of tasks) await t();
  return items;
}

export function mediaPathsFrom(items: MediaItem[], prefix: string) {
  const by = new Map(items.map((i) => [i.role, `${prefix}${i.name}`]));
  const photos: Record<string, string> = {};
  const barbers: Record<string, string> = {};
  for (const [role, p] of by) {
    if (role.startsWith('photo:')) photos[role.slice(6)] = p;
    if (role.startsWith('barber:')) barbers[role.slice(7)] = p;
  }
  return { cover_path: by.get('cover') as string, logo_path: by.get('logo'), photos, barbers };
}
