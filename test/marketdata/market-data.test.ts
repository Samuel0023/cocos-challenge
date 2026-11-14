import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CachedMarketDataRepository } from '../../src/modules/marketdata/infra/cached-market-data-repository.ts';
import { PgMarketDataRepository } from '../../src/modules/marketdata/infra/pg-market-data-repository.ts';
import { createTestApp, type TestApp } from '../support/test-app.ts';

describe('latest quotes', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(() => ctx.close());

  it('returns the close of the most recent date for each instrument', async () => {
    const quotes = await new PgMarketDataRepository(ctx.pool).getLatestQuotes([47, 54]);

    expect(quotes.get(47)).toEqual({
      close: '925.85',
      previousClose: '921.80',
      date: '2023-07-14',
    });
    expect(quotes.get(54)?.close).toBe('229.50');
  });

  it('omits instruments without market data', async () => {
    const { rows } = await ctx.pool.query("SELECT id FROM instruments WHERE ticker = 'PGR'");
    const quotes = await new PgMarketDataRepository(ctx.pool).getLatestQuotes([rows[0].id]);

    expect(quotes.size).toBe(0);
  });

  it('caches each quote for 60 seconds and serves later reads from the cache', async () => {
    const repo = new CachedMarketDataRepository(new PgMarketDataRepository(ctx.pool), ctx.cache);

    await repo.getLatestQuotes([47]);
    expect(ctx.cache.entries.get('quote:47')?.ttlSeconds).toBe(60);

    await ctx.pool.query('UPDATE marketdata SET close = 1 WHERE instrumentid = 47');
    expect((await repo.getLatestQuotes([47])).get(47)?.close).toBe('925.85');
  });

  it('reads from PostgreSQL when the cache is down', async () => {
    ctx.cache.failing = true;
    const repo = new CachedMarketDataRepository(new PgMarketDataRepository(ctx.pool), ctx.cache);

    expect((await repo.getLatestQuotes([47])).get(47)?.close).toBe('1.00');
  });
});
