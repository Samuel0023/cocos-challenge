import type { Queryable } from '../../shared/infra/postgres/db.ts';
import type {
  InstrumentRepository,
  InstrumentSearchPage,
  InstrumentSummary,
} from '../application/instrument-repository.ts';

interface Row extends InstrumentSummary {
  total: string;
}

const escapeLike = (text: string) => text.replace(/[\\%_]/g, '\\$&');

export class PgInstrumentRepository implements InstrumentRepository {
  private readonly db: Queryable;

  constructor(db: Queryable) {
    this.db = db;
  }

  async search(text: string, limit: number, offset: number): Promise<InstrumentSearchPage> {
    const { rows } = await this.db.query<Row>(
      `WITH q AS (SELECT unaccent(lower($1::text)) AS text, unaccent(lower($2::text)) AS pattern),
            matches AS (
              SELECT i.id, i.ticker, i.name, i.type,
                     unaccent(lower(i.ticker)) = q.text AS exact,
                     unaccent(lower(i.ticker)) LIKE q.pattern || '%' AS prefix
                FROM instruments i, q
               WHERE unaccent(lower(i.ticker)) LIKE '%' || q.pattern || '%'
                  OR unaccent(lower(i.name)) LIKE '%' || q.pattern || '%'
            )
       SELECT m.id, m.ticker, m.name, m.type,
              (SELECT to_char(md.close, 'FM999999990.00')
                 FROM marketdata md
                WHERE md.instrumentid = m.id
                ORDER BY md.date DESC
                LIMIT 1) AS "lastPrice",
              count(*) OVER () AS total
         FROM matches m
        ORDER BY m.exact DESC, m.prefix DESC, m.ticker
        LIMIT $3 OFFSET $4`,
      [text, escapeLike(text), limit, offset],
    );

    const first = rows[0];
    if (first) {
      return {
        items: rows.map((row) => ({
          id: row.id,
          ticker: row.ticker,
          name: row.name,
          type: row.type,
          lastPrice: row.lastPrice,
        })),
        total: Number(first.total),
      };
    }
    // An offset past the last match returns no rows, so the total needs its own count.
    return { items: [], total: offset > 0 ? await this.count(text) : 0 };
  }

  private async count(text: string): Promise<number> {
    const { rows } = await this.db.query<{ total: string }>(
      `SELECT count(*) AS total FROM instruments
        WHERE unaccent(lower(ticker)) LIKE '%' || unaccent(lower($1::text)) || '%' ESCAPE '\\'
           OR unaccent(lower(name)) LIKE '%' || unaccent(lower($1::text)) || '%' ESCAPE '\\'`,
      [escapeLike(text)],
    );
    return Number(rows[0]?.total ?? 0);
  }
}
