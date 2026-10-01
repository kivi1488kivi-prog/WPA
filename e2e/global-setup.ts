import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

export default async function globalSetup() {
  const env = { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? 'postgres' };
  execSync('tools/local-stack/local-up.sh', { cwd: ROOT, stdio: 'inherit', env });
  execSync('tools/local-stack/start-bg.sh', { cwd: ROOT, stdio: 'inherit', env });
  execSync('npx tsx tools/local-stack/seed-staff.ts', { cwd: ROOT, stdio: 'inherit', env: { ...env, ...loadEnvLocal() } });
}

function loadEnvLocal(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(l);
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}
