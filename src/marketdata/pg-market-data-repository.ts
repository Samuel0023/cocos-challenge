import type { Queryable } from '../shared/infra/postgres/db.ts';
import type { MarketDataRepository, Quote } from './market-data-repository.ts';

interface Row {
  instrumentid: number;
  close: string;
  previousclose: string;
  date: string;
}

export class PgMarketDataRepository implements MarketDataRepository {
  private readonly db: Queryable;

  constructor(db: Queryable) {
    this.db = db;
  }

  async getLatestQuotes(instrumentIds: number[]): Promise<Map<number, Quote>> {
    if (instrumentIds.length === 0) return new Map();
    const { rows } = await this.db.query<Row>(
      `SELECT DISTINCT ON (instrumentid) instrumentid, close, previousclose, date
         FROM marketdata
        WHERE instrumentid = ANY($1::int[])
        ORDER BY instrumentid, date DESC`,
      [instrumentIds],
    );
    return new Map(
      rows.map((row) => [
        row.instrumentid,
        { close: row.close, previousClose: row.previousclose, date: row.date },
      ]),
    );
  }
}
