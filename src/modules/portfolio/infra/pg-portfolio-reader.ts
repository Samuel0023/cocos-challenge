import type { Queryable } from '../../../platform/postgres/db.ts';
import { Money } from '../../../platform/money.ts';
import type { Holding } from '../domain/position-valuation.ts';
import type { CashSummary, PortfolioReader } from '../application/portfolio-reader.ts';

interface CashRow {
  balance: string;
  reserved: string;
}

interface HoldingRow {
  instrumentid: number;
  ticker: string;
  name: string;
  quantity: string;
  buysize: string;
  buycost: string;
}

export class PgPortfolioReader implements PortfolioReader {
  private readonly db: Queryable;

  constructor(db: Queryable) {
    this.db = db;
  }

  async userExists(userId: number): Promise<boolean> {
    const { rowCount } = await this.db.query('SELECT 1 FROM users WHERE id = $1', [userId]);
    return rowCount === 1;
  }

  async getCash(userId: number): Promise<CashSummary> {
    const { rows } = await this.db.query<CashRow>(
      // size × price has scale 4 but is always a whole number of cents (shares are whole and
      // transfers are priced at 1), so ROUND to 2 places is exact.
      `SELECT
         ROUND(COALESCE(SUM(CASE WHEN side IN ('CASH_IN', 'SELL') THEN size * price
                                 ELSE -size * price END)
                        FILTER (WHERE status = 'FILLED'), 0), 2) AS balance,
         ROUND(COALESCE(SUM(size * price)
                        FILTER (WHERE status = 'NEW' AND side = 'BUY' AND type = 'LIMIT'), 0), 2)
           AS reserved
         FROM orders
        WHERE userid = $1 AND status IN ('FILLED', 'NEW')`,
      [userId],
    );
    // An aggregate without GROUP BY always returns exactly one row.
    const row = rows[0] as CashRow;
    return { balance: Money.parse(row.balance), reserved: Money.parse(row.reserved) };
  }

  async getHoldings(userId: number): Promise<Holding[]> {
    const { rows } = await this.db.query<HoldingRow>(
      `SELECT o.instrumentid, i.ticker, i.name,
              SUM(CASE WHEN o.side = 'BUY' THEN o.size ELSE -o.size END) AS quantity,
              COALESCE(SUM(o.size) FILTER (WHERE o.side = 'BUY'), 0) AS buysize,
              ROUND(COALESCE(SUM(o.size * o.price) FILTER (WHERE o.side = 'BUY'), 0), 2) AS buycost
         FROM orders o
         JOIN instruments i ON i.id = o.instrumentid
        WHERE o.userid = $1 AND o.status = 'FILLED' AND o.side IN ('BUY', 'SELL')
          AND i.type <> 'MONEDA'
        GROUP BY o.instrumentid, i.ticker, i.name`,
      [userId],
    );
    return rows.map((row) => ({
      instrumentId: row.instrumentid,
      ticker: row.ticker,
      name: row.name,
      // Share sums come back as NUMERIC text such as "40.00"; shares are whole.
      quantity: Number(row.quantity),
      buySize: Number(row.buysize),
      buyCost: Money.parse(row.buycost),
    }));
  }
}
