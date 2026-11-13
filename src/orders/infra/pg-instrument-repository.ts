import type { Queryable } from '../../shared/infra/postgres/db.ts';
import type { Instrument, InstrumentRepository } from '../application/ports.ts';

export class PgOrderInstrumentRepository implements InstrumentRepository {
  private readonly db: Queryable;

  constructor(db: Queryable) {
    this.db = db;
  }

  async findById(id: number): Promise<Instrument | null> {
    const { rows } = await this.db.query<Instrument>(
      'SELECT id, ticker, type FROM instruments WHERE id = $1',
      [id],
    );
    return rows[0] ?? null;
  }

  async findCash(): Promise<Instrument> {
    const { rows } = await this.db.query<Instrument>(
      "SELECT id, ticker, type FROM instruments WHERE ticker = 'ARS' AND type = 'MONEDA'",
    );
    if (!rows[0]) throw new Error('The ARS instrument is missing from the database');
    return rows[0];
  }
}
