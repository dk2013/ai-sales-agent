// One shared connection pool (cached on globalThis so Next.js hot reload doesn't open new pools).
import { Pool, type PoolClient } from "pg";
import { config } from "./config";

const g = globalThis as unknown as { pgPool?: Pool };
export const pool = (g.pgPool ??= new Pool({ connectionString: config.databaseUrl, max: 5 }));

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
