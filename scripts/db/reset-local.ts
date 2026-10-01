/**
 * Recreate the local test database (Supabase shim + migrations [+ seed]).
 *   npm run db:reset [-- --seed]       env: LOCAL_DB_NAME (default barbershop_test)
 * Works on Windows, macOS and Linux — needs only a running PostgreSQL 15+.
 */
import { resetDatabase } from '../../tools/local-stack/db.ts';

const db = process.env.LOCAL_DB_NAME ?? 'barbershop_test';
const n = await resetDatabase(db, process.argv.includes('--seed'));
console.log(`local db '${db}' ready (${n} migrations)`);
