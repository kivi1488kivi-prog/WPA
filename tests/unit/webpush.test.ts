import { describe, expect, it } from 'vitest';
import { b64urlDecode, b64urlEncode, classifyStatus, encryptPayload, generateVapidKeys, sendPush, vapidAuthorization } from '../../supabase/functions/_shared/webpush.ts';

const enc = new TextEncoder();

async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, n: number) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, n * 8));
}
const cat = (...p: Uint8Array[]) => {
  const o = new Uint8Array(new ArrayBuffer(p.reduce((a, x) => a + x.length, 0)));
  let i = 0;
  for (const x of p) (o.set(x, i), (i += x.length));
  return o;
};

/** Independent RFC 8291 decryption, acting as the browser (user agent). */
async function decrypt(body: Uint8Array, ua: CryptoKeyPair, uaPublic: Uint8Array<ArrayBuffer>, auth: Uint8Array<ArrayBuffer>) {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset).getUint32(16);
  const idlen = body[20]!;
  const asPublic = body.slice(21, 21 + idlen);
  const ct = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
  const ikm = await hkdf(auth, ecdh, cat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ct));
  expect(plain.at(-1)).toBe(2);
  return { rs, text: new TextDecoder().decode(plain.slice(0, -1)) };
}

async function uaKeys() {
  const ua = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  return { ua, uaPublic, auth, target: { endpoint: 'https://push.example.test/send/abc', p256dh: b64urlEncode(uaPublic), auth: b64urlEncode(auth) } };
}

describe('Web Push (RFC 8291 / 8292)', () => {
  it('encrypts a payload that the user agent can decrypt (aes128gcm)', async () => {
    const k = await uaKeys();
    const body = await encryptPayload(k.target, enc.encode('{"title":"Hallo","body":"Termin"}'));
    const out = await decrypt(body, k.ua, k.uaPublic, k.auth);
    expect(out.rs).toBe(4096);
    expect(JSON.parse(out.text)).toEqual({ title: 'Hallo', body: 'Termin' });
  });

  it('signs a VAPID JWT verifiable with the public key, audience = push origin', async () => {
    const keys = { ...(await generateVapidKeys()), subject: 'mailto:test@example.com' };
    const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/xyz', keys, 1_800_000_000);
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)!;
    expect(m[4]).toBe(keys.publicKey);
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(m[2]!)));
    expect(claims).toMatchObject({ aud: 'https://fcm.googleapis.com', sub: 'mailto:test@example.com', exp: 1_800_000_000 + 12 * 3600 });
    const pub = await crypto.subtle.importKey('raw', b64urlDecode(keys.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, b64urlDecode(m[3]!), enc.encode(`${m[1]}.${m[2]}`));
    expect(ok).toBe(true);
  });

  it('sends with required headers and maps push-service status codes', async () => {
    const k = await uaKeys();
    const keys = { ...(await generateVapidKeys()), subject: 'mailto:t@example.com' };
    const seen: { url: string; init: RequestInit }[] = [];
    const fake = (status: number) => (async (url: string, init: RequestInit) => (seen.push({ url, init }), new Response(null, { status }))) as unknown as typeof fetch;
    expect((await sendPush(k.target, { title: 'x' }, keys, { fetchImpl: fake(201), topic: 'booking-1' })).outcome).toBe('sent');
    const h = seen[0]!.init.headers as Record<string, string>;
    expect(h['Content-Encoding']).toBe('aes128gcm');
    expect(h.TTL).toBe('86400');
    expect(h.Authorization).toMatch(/^vapid t=/);
    expect(h.Topic).toBe('booking-1');
    const out = await decrypt(new Uint8Array(seen[0]!.init.body as Uint8Array), k.ua, k.uaPublic, k.auth);
    expect(JSON.parse(out.text)).toEqual({ title: 'x' });
    expect((await sendPush(k.target, {}, keys, { fetchImpl: fake(410) })).outcome).toBe('gone');
    expect((await sendPush(k.target, {}, keys, { fetchImpl: fake(503) })).outcome).toBe('retry');
    expect(classifyStatus(400)).toBe('failed');
  });
});
