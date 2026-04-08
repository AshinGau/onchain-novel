import pg from "pg";
import { env } from "../utils/env.js";

const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

export default pool;

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params);
}

export async function getClient() {
  return pool.connect();
}
