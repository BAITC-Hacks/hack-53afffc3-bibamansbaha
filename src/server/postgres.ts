import { Pool, type PoolClient } from 'pg';
import { AppError } from './errors';

let pool: Pool | undefined;
let sessionPool: Pool | undefined;
export function postgres() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new AppError('DATABASE_CONFIG', 'Постоянное хранилище не настроено.', 503);
  return pool ??= new Pool({ connectionString, max: 3, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 10_000, allowExitOnIdle: true });
}
export async function pgTransaction<T>(action: (client: PoolClient) => Promise<T>, session=false): Promise<T> {
  // Session transactions remain open while calling the provider. Separate capacity is
  // essential: budget reservations/status must not wait for those same connections.
  if(session&&!sessionPool)sessionPool=new Pool({connectionString:process.env.DATABASE_URL,max:3,connectionTimeoutMillis:10_000,idleTimeoutMillis:10_000,allowExitOnIdle:true});
  const client = await (session?sessionPool!:postgres()).connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '15s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '55s'");
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}
export async function closePostgres(){await Promise.all([pool?.end(),sessionPool?.end()]);pool=undefined;sessionPool=undefined;}
