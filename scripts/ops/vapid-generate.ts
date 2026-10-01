/**
 * Generates a VAPID key pair (P-256) for Web Push.
 *   npm run vapid:generate
 * Public key → VITE_VAPID_PUBLIC_KEY (build) and VAPID_PUBLIC_KEY (function secret).
 * Private key → VAPID_PRIVATE_KEY (function secret only). Never commit it.
 */
import { generateVapidKeys } from '../../supabase/functions/_shared/webpush.ts';

const { publicKey, privateKey } = await generateVapidKeys();
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VITE_VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.error('\nStore VAPID_PRIVATE_KEY only as a Supabase secret. Rotating keys invalidates existing subscriptions.');
