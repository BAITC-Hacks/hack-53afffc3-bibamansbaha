import { readFileSync } from 'node:fs';
import { postgres, pgTransaction } from '../src/server/postgres';
const sql = readFileSync(new URL('../migrations/001_neon.sql', import.meta.url), 'utf8');
async function main(){try {
  await pgTransaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(530053)');
    await client.query(sql);
  });
  console.log('Migration 001_neon applied. No local database or user data imported.');
} catch (error) {
  console.error('Migration failed; PostgreSQL code:', (error as {code?:string}).code ?? 'unknown');
  process.exitCode = 1;
} finally { await postgres().end(); }}
void main();
