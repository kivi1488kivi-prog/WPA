import { env } from './env';

export const MEDIA_BUCKET = 'tenant-media';

/** Public URL of a tenant media object (bucket is public-read). */
export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return `${env.supabaseUrl}/storage/v1/object/public/${MEDIA_BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`;
}
