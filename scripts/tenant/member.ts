/**
 * npm run tenant:member -- <slug> <email> <owner|admin|barber> [--barber=<barber-key>] [--password=<pw>]
 * Creates (or reuses) an Auth user via the admin API and grants a membership.
 * There is no public sign-up; this is the only way staff accounts appear.
 */
import { randomBytes } from 'node:crypto';
import { adminClient, args } from './env.ts';

const { values, positional } = args();
const [slug, email, role] = positional;
if (!slug || !email || !role || !['owner', 'admin', 'barber'].includes(role)) {
  console.error('usage: npm run tenant:member -- <slug> <email> <owner|admin|barber> [--barber=<key>] [--password=<pw>]');
  process.exit(2);
}
if (role === 'barber' && !values.barber) {
  console.error('✗ role barber requires --barber=<barber-key>');
  process.exit(2);
}
const db = adminClient();
const password = values.password ?? randomBytes(9).toString('base64url');
let userId: string | null = null;
const created = await db.auth.admin.createUser({ email, password, email_confirm: true });
if (created.error) {
  const list = await db.auth.admin.listUsers({ perPage: 1000 });
  userId = list.data?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id ?? null;
  if (!userId) {
    console.error('✗ could not create or find user:', created.error.message);
    process.exit(1);
  }
  console.log(`  user exists: ${email}`);
} else {
  userId = created.data.user?.id ?? (created.data as unknown as { id: string }).id;
  console.log(`  user created: ${email}${values.password ? '' : `  temporary password: ${password}`}`);
}
const r = await db.rpc('pipeline_set_member', { p_slug: slug, p_user_id: userId, p_role: role, p_barber_key: values.barber ?? null });
if (r.error) {
  console.error('✗ membership failed:', r.error.message);
  process.exit(1);
}
console.log(`✓ ${email} is ${role} of ${slug}${values.barber ? ` (barber ${values.barber})` : ''}`);
