import pg from 'pg';

// NUMERIC and DATE come back as strings: money never goes through binary floating point.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

/** Anything that can run a query: the pool or a client inside a transaction. */
export type Queryable = Pick<pg.Pool, 'query'>;

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString });
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
