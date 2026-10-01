import { getSupabase } from '@/lib/supabase';
import { MEDIA_BUCKET } from '@/lib/media';

const MAX_BYTES = 5 * 1024 * 1024;

/** Downscale in the browser (JPEG) before upload: faster on mobile data, smaller storage. */
export async function resizeImage(file: File, maxSide: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b ?? file), 'image/jpeg', 0.82));
}

/**
 * Upload into tenant-media/<tenantId>/owner/… — Storage RLS only allows
 * owner/admin of that tenant to write there. Returns the storage path.
 */
export async function uploadTenantImage(slug: string, tenantId: string, file: File, maxSide = 1600): Promise<string> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('invalid_input');
  const blob = await resizeImage(file, maxSide);
  if (blob.size > MAX_BYTES) throw new Error('too_large');
  const path = `${tenantId}/owner/${crypto.randomUUID()}.jpg`;
  const { error } = await getSupabase(slug).storage.from(MEDIA_BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false, cacheControl: '31536000' });
  if (error) throw error;
  return path;
}

export async function deleteTenantImage(slug: string, path: string): Promise<void> {
  if (!path.includes('/owner/')) return; // pipeline assets are managed by the pipeline
  await getSupabase(slug).storage.from(MEDIA_BUCKET).remove([path]);
}
