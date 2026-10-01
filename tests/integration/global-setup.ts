import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
export const FAKE_LLM_PORT = 54999;

/** Fresh local DB + seed, local stack with test env, demo staff. */
export default async function setup() {
  const run = (cmd: string) => execSync(cmd, { cwd: ROOT, stdio: 'pipe', env: { ...process.env, PGPASSWORD: 'postgres' } }).toString();
  run('tools/local-stack/local-up.sh');
  const env = {
    ...process.env,
    LLM_BASE_URL: `http://localhost:${FAKE_LLM_PORT}/v1`,
    LLM_API_KEY: 'test-key',
    LLM_MODEL: 'fake-model',
    CRON_SECRET: 'test-cron-secret',
    AI_GLOBAL_DAILY_REQUESTS: '10000',
  };
  execSync('tools/local-stack/start-bg.sh', { cwd: ROOT, stdio: 'pipe', env });
  execSync('npx tsx tools/local-stack/seed-staff.ts', { cwd: ROOT, stdio: 'pipe', env: { ...env, ...parseEnv() } });
  return async () => {
    try {
      const pid = Number(readFileSync(path.join(ROOT, '.local-stack/pid'), 'utf8'));
      process.kill(pid);
    } catch {
      /* already stopped */
    }
  };
}

export function parseEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line);
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}
