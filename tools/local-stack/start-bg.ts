/**
 * Start (or restart) the local stack in the background; pid in .local-stack/pid, log in .local-stack/server.log.
 *   npm run local:start      /      npm run local:stop
 * (For a foreground server with live logs use `npm run local:stack`.)
 */
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './db.ts';

const dir = path.join(ROOT, '.local-stack');
const pidFile = path.join(dir, 'pid');
mkdirSync(dir, { recursive: true });

function stop(): void {
  if (!existsSync(pidFile)) return;
  try {
    process.kill(Number(readFileSync(pidFile, 'utf8')));
  } catch {
    /* not running */
  }
  unlinkSync(pidFile);
}

if (process.argv.includes('--stop')) {
  stop();
  console.log('local stack stopped');
  process.exit(0);
}

stop();
await new Promise((r) => setTimeout(r, 500));
const log = openSync(path.join(dir, 'server.log'), 'w');
const child = spawn(process.execPath, ['--import', 'tsx', 'tools/local-stack/server.ts'], { cwd: ROOT, detached: true, stdio: ['ignore', log, log], windowsHide: true });
child.unref();
closeSync(log);
writeFileSync(pidFile, String(child.pid));

const port = process.env.LOCAL_STACK_PORT ?? '54321';
for (let i = 0; i < 80; i++) {
  try {
    if ((await fetch(`http://localhost:${port}/health`)).ok) {
      console.log(`local stack up (pid ${child.pid}) → http://localhost:${port}`);
      process.exit(0);
    }
  } catch {
    /* not yet */
  }
  await new Promise((r) => setTimeout(r, 250));
}
console.error('local stack failed to start:\n' + readFileSync(path.join(dir, 'server.log'), 'utf8'));
process.exit(1);
