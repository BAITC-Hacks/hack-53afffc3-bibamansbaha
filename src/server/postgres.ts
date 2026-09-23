import { Pool, type PoolClient } from 'pg';
import { AppError } from './errors';

let pool: Pool | undefined;
export function postgres() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new AppError('DATABASE_CONFIG', 'Постоянное хранилище не настроено.', 503);
  return pool ??= new Pool({ connectionString, max: 3, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 10_000, allowExitOnIdle: true });
}
export async function pgTransaction<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await postgres().connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '15s'");
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}
