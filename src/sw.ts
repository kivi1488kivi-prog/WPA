/// <reference lib="webworker" />
/**
 * One service-worker source for every tenant (vite-plugin-pwa injectManifest).
 * build:shells copies the built file to /s/{slug}/sw.js and
 * /s/{slug}/owner/sw.js, so each tenant (and its owner cabinet) gets its own
 * registration scope and its own cache names derived from that scope.
 *
 * Caching policy:
 *  - shared JS/CSS: precached (hashed, immutable)
 *  - navigations inside the scope: network-first, fallback to the cached shell
 *  - tenant images (static /s/{slug}/... and public Storage objects): cache-first
 *  - API calls (/rest, /auth, /functions, any non-GET): never cached
 */
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { clientsClaim, setCacheNameDetails } from 'workbox-core';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

const scopePath = new URL(self.registration.scope).pathname;
const match = /^\/s\/([a-z0-9-]+)\/(owner\/)?$/.exec(scopePath);
const slug = match?.[1] ?? 'root';
const area = match?.[2] ? 'owner' : 'client';
const prefix = `bk-${slug}-${area}`;

setCacheNameDetails({ prefix, suffix: 'v1', precache: 'precache', runtime: 'runtime' });
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

const isApi = (url: URL) => /\/(rest|auth|functions|realtime)\/v1\//.test(url.pathname);

registerRoute(
  new NavigationRoute(new NetworkFirst({ cacheName: `${prefix}-shell`, networkTimeoutSeconds: 4 }), {
    allowlist: [new RegExp(`^${scopePath.replace(/[/-]/g, (c) => `\\${c}`)}`)],
  }),
);

registerRoute(
  ({ url, request }) =>
    request.method === 'GET' &&
    request.destination === 'image' &&
    !isApi(url) &&
    ((url.origin === self.location.origin && url.pathname.startsWith(`/s/${slug}/`)) || url.pathname.includes('/storage/v1/object/public/')),
  new CacheFirst({
    cacheName: `bk-${slug}-media`,
    plugins: [new ExpirationPlugin({ maxEntries: 120, maxAgeSeconds: 30 * 24 * 3600 })],
  }),
);

self.addEventListener('message', (event) => {
  const data = event.data as { type?: string } | string | undefined;
  if (data === 'SKIP_WAITING' || (typeof data === 'object' && data?.type === 'SKIP_WAITING')) void self.skipWaiting();
});

interface PushPayload { title?: string; body?: string; url?: string; tag?: string }

self.addEventListener('push', (event) => {
  let payload: PushPayload = {};
  try {
    payload = (event.data?.json() as PushPayload) ?? {};
  } catch {
    payload = { body: event.data?.text() };
  }
  const iconBase = `/s/${slug}/icons`;
  event.waitUntil(
    self.registration.showNotification(payload.title ?? '', {
      body: payload.body ?? '',
      tag: payload.tag,
      icon: `${iconBase}/icon-192.png`,
      badge: `${iconBase}/icon-192.png`,
      data: { url: payload.url ?? scopePath },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data as { url?: string } | undefined)?.url ?? scopePath, self.location.origin);
  // Only open URLs inside this worker's own tenant scope.
  const safe = target.origin === self.location.origin && target.pathname.startsWith(`/s/${slug}/`) ? target.href : new URL(scopePath, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of windows) {
        if (w.url.startsWith(new URL(scopePath, self.location.origin).href) && 'focus' in w) {
          await w.navigate(safe).catch(() => undefined);
          return w.focus();
        }
      }
      return self.clients.openWindow(safe);
    })(),
  );
});

void self.skipWaiting();
clientsClaim();
