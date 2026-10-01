/**
 * Cross-platform helpers for the local PostgreSQL (no psql, no bash needed).
 * Connection comes from the standard libpq variables, defaults: localhost:5432, user postgres,
 * password "postgres":  PGHOST, PGPORT, PGUSER, PGPASSWORD.
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

export const ROOT = path.resolve(import.meta.dirname, '../..');

export const conn = {
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD ?? 'postgres',
};

export function databaseUrl(db: string): string {
  return `postgres://${encodeURIComponent(conn.user)}:${encodeURIComponent(conn.password)}@${conn.host}:${conn.port}/${db}`;
}

async function connect(database: string): Promise<pg.Client> {
  const client = new pg.Client({ ...conn, database });
  client.on('notice', () => {});
  try {
    await client.connect();
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { code?: string };
    console.error(`\n✗ Cannot connect to PostgreSQL at ${conn.host}:${conn.port} as "${conn.user}" (${e.code ?? e.message}).`);
    if (e.code === 'ECONNREFUSED') {
      console.error('  PostgreSQL is not running. Windows: Win+R → services.msc → "postgresql-x64-16" → Start.');
      console.error('  Linux: sudo systemctl start postgresql   (or pg_ctlcluster 16 main start)');
    } else if (e.code === '28P01') {
      console.error('  Wrong password. Set the password you chose when installing PostgreSQL:');
      console.error('    Windows cmd:  set PGPASSWORD=your-password');
      console.error('    PowerShell:   $env:PGPASSWORD="your-password"');
      console.error('    bash:         export PGPASSWORD=your-password');
    }
    process.exit(1);
  }
  return client;
}

/** Recreates DB `name`: Supabase shim + all migrations (+ supabase/seed.sql with seed=true). */
export async function resetDatabase(name: string, seed = false): Promise<number> {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`invalid database name: ${name}`);
  const admin = await connect('postgres');
  try {
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.query(`create database ${name}`);
  } finally {
    await admin.end();
  }
  const db = await connect(name);
  const run = async (file: string) => {
    const sql = await readFile(path.join(ROOT, file), 'utf8');
    try {
      await db.query('set client_min_messages = warning');
      await db.query(sql);
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === '0A000' || /btree_gist|pgcrypto|extension/.test(e.message)) {
        console.error('  Hint: PostgreSQL contrib extensions (btree_gist, pgcrypto) are required — the official installer includes them.');
      }
      console.error(`✗ ${file}: ${e.message}`);
      process.exit(1);
    }
  };
  try {
    await run('supabase/tests/shim/supabase_shim.sql');
    const migrations = (await readdir(path.join(ROOT, 'supabase/migrations'))).filter((f) => f.endsWith('.sql')).sort();
    for (const f of migrations) await run(`supabase/migrations/${f}`);
    if (seed) await run('supabase/seed.sql');
    return migrations.length;
  } finally {
    await db.end();
  }
}
