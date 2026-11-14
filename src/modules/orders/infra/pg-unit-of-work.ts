import type pg from 'pg';
import { withTransaction } from '../../../platform/postgres/db.ts';
import type { Transaction, UnitOfWork } from '../application/ports.ts';
import { PgFundsReader } from './pg-funds-reader.ts';
import { PgOrderRepository } from './pg-order-repository.ts';

export class PgUnitOfWork implements UnitOfWork {
  private readonly pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  run<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTransaction(this.pool, (db) =>
      work({
        // Serialises every order of one user: balance checks then see each other's commits.
        lockUser: async (userId) => {
          const { rowCount } = await db.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [
            userId,
          ]);
          return rowCount === 1;
        },
        orders: new PgOrderRepository(db),
        funds: new PgFundsReader(db),
      }),
    );
  }
}
