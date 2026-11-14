import pg from 'pg';
import type { Logger } from '../logger.ts';

// NUMERIC and DATE come back as strings: money never goes through binary floating point.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

/** Anything that can run a query: the pool or a client inside a transaction. */
export type Queryable = Pick<pg.Pool, 'query'>;

/**
 * The pool emits 'error' when an idle connection fails (PostgreSQL restarted, a backend was
 * terminated). Without a listener Node throws it and the process dies; the pool has already
 * discarded that connection, so logging it is all there is to do.
 */
export function createPool(connectionString: string, logger?: Pick<Logger, 'error'>): pg.Pool {
  const pool = new pg.Pool({ connectionString });
  pool.on('error', (error) => logger?.error({ err: error }, 'idle postgres connection failed'));
  return pool;
}

/**
 * Runs `work` inside one transaction at READ COMMITTED (the PostgreSQL default).
 * The row lock on the user relies on that level; see docs/decisions.md, D-10.
 */
export async function withTransaction<T>(
  pool: pg.Pool,
  work: (tx: Queryable) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
