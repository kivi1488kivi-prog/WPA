// Booking access tokens saved on THIS device, per tenant. This is a per-viewer
// convenience only; the server is the source of truth and every token is
// validated on each request.
export interface SavedBooking { token: string; savedAt: string; startsAt?: string }

const key = (slug: string) => `bk-bookings:${slug}`;

export function listSaved(slug: string): SavedBooking[] {
  try {
    const raw = localStorage.getItem(key(slug));
    const arr = raw ? (JSON.parse(raw) as SavedBooking[]) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x?.token === 'string') : [];
  } catch {
    return [];
  }
}

export function saveToken(slug: string, token: string, startsAt?: string): void {
  try {
    const list = listSaved(slug).filter((x) => x.token !== token);
    list.unshift({ token, savedAt: new Date().toISOString(), ...(startsAt ? { startsAt } : {}) });
    localStorage.setItem(key(slug), JSON.stringify(list.slice(0, 30)));
  } catch {
    /* private mode: booking link still works */
  }
}

export function removeToken(slug: string, token: string): void {
  try {
    localStorage.setItem(key(slug), JSON.stringify(listSaved(slug).filter((x) => x.token !== token)));
  } catch {
    /* ignore */
  }
}
