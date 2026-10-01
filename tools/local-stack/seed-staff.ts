/** Demo staff accounts for local development/E2E (local emulator only). */
import { adminClient } from '../../scripts/tenant/env.ts';

export const DEMO_STAFF = [
  { slug: 'demo-studio', email: 'owner@demo-studio.test', role: 'owner', barber: null },
  { slug: 'demo-studio', email: 'admin@demo-studio.test', role: 'admin', barber: null },
  { slug: 'demo-studio', email: 'alexey@demo-studio.test', role: 'barber', barber: 'alexey' },
  { slug: 'demo-harbor', email: 'owner@demo-harbor.test', role: 'owner', barber: null },
] as const;
export const DEMO_PASSWORD = 'demo-password-123';

const db = adminClient();
if (!(process.env.SUPABASE_URL ?? '').includes('localhost')) {
  console.error('refusing to create demo staff outside the local emulator');
  process.exit(1);
}
for (const s of DEMO_STAFF) {
  const u = await db.auth.admin.createUser({ email: s.email, password: DEMO_PASSWORD, email_confirm: true });
  const id = (u.data?.user?.id ?? (u.data as unknown as { id?: string })?.id) as string;
  const r = await db.rpc('pipeline_set_member', { p_slug: s.slug, p_user_id: id, p_role: s.role, p_barber_key: s.barber });
  if (u.error || r.error) {
    console.error('✗', s.email, u.error?.message ?? r.error?.message);
    process.exit(1);
  }
}
console.log(`✓ demo staff: ${DEMO_STAFF.map((s) => s.email).join(', ')} / ${DEMO_PASSWORD}`);
