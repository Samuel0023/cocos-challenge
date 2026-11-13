import { Money } from '../../../platform/money.ts';
import type { Queryable } from '../../../platform/postgres/db.ts';
import type { AccountReader } from '../application/ports.ts';

export class PgAccountReader implements AccountReader {
  private readonly db: Queryable;

  constructor(db: Queryable) {
    this.db = db;
  }

  /** FILLED movements minus the cash reserved by NEW LIMIT BUYs, computed in NUMERIC. */
  async availableCash(userId: number): Promise<Money> {
    const { rows } = await this.db.query<{ cash: string }>(
      `SELECT COALESCE(SUM(
                CASE
                  WHEN status = 'FILLED' AND side IN ('CASH_IN', 'SELL') THEN size * price
                  WHEN status = 'FILLED' AND side IN ('CASH_OUT', 'BUY') THEN -size * price
                  WHEN status = 'NEW' AND type = 'LIMIT' AND side = 'BUY' THEN -size * price
                  ELSE 0
                END), 0)::numeric(20, 2)::text AS cash
         FROM orders
        WHERE userid = $1`,
      [userId],
    );
    return Money.parse(rows[0]?.cash ?? '0');
  }

  /** FILLED BUYs minus FILLED SELLs minus the shares reserved by NEW LIMIT SELLs. */
  async availableShares(userId: number, instrumentId: number): Promise<number> {
    const { rows } = await this.db.query<{ shares: string }>(
      `SELECT COALESCE(SUM(
                CASE
                  WHEN status = 'FILLED' AND side = 'BUY' THEN size
                  WHEN status = 'FILLED' AND side = 'SELL' THEN -size
                  WHEN status = 'NEW' AND type = 'LIMIT' AND side = 'SELL' THEN -size
                  ELSE 0
                END), 0)::text AS shares
         FROM orders
        WHERE userid = $1 AND instrumentid = $2`,
      [userId, instrumentId],
    );
    return Number(rows[0]?.shares ?? 0);
  }
}
