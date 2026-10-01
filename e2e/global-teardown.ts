import { readFileSync } from 'node:fs';
import path from 'node:path';

export default async function globalTeardown() {
  try {
    process.kill(Number(readFileSync(path.resolve(import.meta.dirname, '../.local-stack/pid'), 'utf8')));
  } catch {
    /* not running */
  }
}
