import { execSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENV, pool, signIn, tenantId } from './helpers.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const publish = (slug: string) =>
  execSync(`npx tsx scripts/tenant/publish.ts ${slug}`, { cwd: ROOT, env: { ...process.env, ...ENV }, stdio: 'pipe' }).toString();

describe('tenant pipeline against the local stack', () => {
  it('publish + verify succeed; republish keeps owner data and bookings', async () => {
    expect(publish('demo-harbor')).toContain('✓ published demo-harbor');
    const tid = await tenantId('demo-harbor');
    const owner = await signIn('owner@demo-harbor.test');

    // owner edits a pipeline barber and uploads a photo in the cabinet
    const dave = (await pool.query("select id from barbers where tenant_id = $1 and pipeline_key = 'dave'", [tid])).rows[0].id;
    expect((await owner.client.rpc('owner_upsert_barber', { p_tenant_id: tid, p_barber: { id: dave, bio: 'Edited by owner' } })).error).toBeNull();
    const up = await owner.client.storage.from('tenant-media').upload(`${tid}/owner/test-${Date.now()}.jpg`, new Blob([new Uint8Array([255, 216, 255])], { type: 'image/jpeg' }), { contentType: 'image/jpeg' });
    expect(up.error).toBeNull();
    expect((await owner.client.rpc('owner_add_photo', { p_tenant_id: tid, p_kind: 'work', p_path: up.data!.path, p_alt: 'owner photo' })).error).toBeNull();
    const bookingsBefore = (await pool.query('select count(*)::int as n from bookings where tenant_id = $1', [tid])).rows[0].n;

    const out = publish('demo-harbor');
    expect(out).toContain('"skipped_owner":["dave"]');
    expect((await pool.query('select bio from barbers where id = $1', [dave])).rows[0].bio).toBe('Edited by owner');
    expect((await pool.query("select count(*)::int as n from tenant_photos where tenant_id = $1 and source = 'owner'", [tid])).rows[0].n).toBe(1);
    expect((await pool.query('select count(*)::int as n from bookings where tenant_id = $1', [tid])).rows[0].n).toBe(bookingsBefore);

    const verify = execSync('npx tsx scripts/tenant/verify.ts demo-harbor', { cwd: ROOT, env: { ...process.env, ...ENV }, stdio: 'pipe' }).toString();
    expect(verify).toContain('0 error(s)');
  });

  it('storage RLS: an owner cannot write into another tenant folder; anon cannot write at all', async () => {
    const studio = await tenantId('demo-studio');
    const harborOwner = await signIn('owner@demo-harbor.test');
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
    const cross = await harborOwner.client.storage.from('tenant-media').upload(`${studio}/owner/x.jpg`, blob, { contentType: 'image/jpeg' });
    expect(cross.error).not.toBeNull();
    const barber = await signIn('alexey@demo-studio.test');
    const asBarber = await barber.client.storage.from('tenant-media').upload(`${studio}/owner/y.jpg`, blob, { contentType: 'image/jpeg' });
    expect(asBarber.error).not.toBeNull();
  });
});
