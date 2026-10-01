import { env } from './env';

export type PushSupport = 'supported' | 'unsupported' | 'ios-needs-install' | 'not-configured';

export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/**
 * Honest capability check. iOS Safari only delivers Web Push to an app that
 * was added to the Home Screen; a regular tab never gets push there.
 */
export function pushSupport(): PushSupport {
  if (!env.vapidPublicKey) return 'not-configured';
  if (isIos() && !isStandalone()) return 'ios-needs-install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  return 'supported';
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export type SwArea = 'client' | 'owner';

export function swScope(slug: string, area: SwArea): string {
  return area === 'owner' ? `/s/${slug}/owner/` : `/s/${slug}/`;
}

/** Register the tenant-scoped service worker (one file per scope, shared source). */
export async function registerServiceWorker(slug: string, area: SwArea): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return null;
  const scope = swScope(slug, area);
  try {
    return await navigator.serviceWorker.register(`${scope}sw.js`, { scope, type: 'classic' });
  } catch {
    return null;
  }
}

export async function subscribePush(slug: string, area: SwArea): Promise<PushSubscriptionJSON> {
  const support = pushSupport();
  if (support !== 'supported') throw new Error(support);
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('denied');
  const reg = (await navigator.serviceWorker.getRegistration(swScope(slug, area))) ?? (await registerServiceWorker(slug, area));
  if (!reg) throw new Error('no-service-worker');
  await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(env.vapidPublicKey) }));
  return sub.toJSON();
}

export async function currentPushEndpoint(slug: string, area: SwArea): Promise<string | null> {
  if (!('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration(swScope(slug, area));
  const sub = await reg?.pushManager.getSubscription();
  return sub?.endpoint ?? null;
}
