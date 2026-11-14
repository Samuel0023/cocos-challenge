import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../support/test-app.ts';

interface Item {
  id: number;
  ticker: string;
  name: string;
  type: string;
  lastPrice: string | null;
}

describe('GET /instruments', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(() => ctx.close());

  beforeEach(() => {
    ctx.cache.entries.clear();
    ctx.cache.failing = false;
  });

  const search = (query: string) => request(ctx.app).get(`/instruments${query}`);
  const tickers = (items: Item[]) => items.map((item) => item.ticker);

  it('matches part of a ticker', async () => {
    const res = await search('?q=PAM');

    expect(res.status).toBe(200);
    expect(tickers(res.body.items)).toContain('PAMP');
  });

  it('matches part of a name', async () => {
    const res = await search('?q=Holding');

    expect(res.status).toBe(200);
    expect(tickers(res.body.items)).toContain('PAMP');
  });

  it('ignores case', async () => {
    const res = await search('?q=pAmPa%20hOLDING');

    expect(res.status).toBe(200);
    expect(tickers(res.body.items)).toEqual(['PAMP']);
  });

  it('finds accented names when the query has no accent', async () => {
    const res = await search('?q=compania%20introductora');

    expect(res.status).toBe(200);
    expect(tickers(res.body.items)).toEqual(['INTR']);
  });

  it('finds unaccented text when the query has an accent', async () => {
    const res = await search(`?q=${encodeURIComponent('Río de la Plata')}`);

    expect(res.status).toBe(200);
    expect(tickers(res.body.items)).toEqual(['MOLI']);
  });

  it('puts exact ticker matches first, then ticker prefixes, then the rest', async () => {
    await ctx.pool.query(
      `INSERT INTO instruments (ticker, name, type) VALUES
         ('QXQ', 'Zzz one', 'ACCIONES'), ('QXQB', 'Zzz two', 'ACCIONES'),
         ('ZZ', 'Contains qxq inside', 'ACCIONES')`,
    );
    const res = await search('?q=qxq');

    expect(res.status).toBe(200);
    expect(tickers(res.body.items)).toEqual(['QXQ', 'QXQB', 'ZZ']);
  });

  it('returns the latest close with two decimals', async () => {
    const res = await search('?q=PAMP');

    expect(res.status).toBe(200);
    expect(res.body.items[0]).toMatchObject({
      ticker: 'PAMP',
      name: 'Pampa Holding S.A.',
      type: 'ACCIONES',
      lastPrice: '925.85',
    });
    expect(typeof res.body.items[0].id).toBe('number');
  });

  it('returns a null lastPrice for an instrument without market data', async () => {
    const res = await search('?q=PGR');

    expect(res.status).toBe(200);
    expect(res.body.items.find((item: Item) => item.ticker === 'PGR').lastPrice).toBeNull();
  });

  it('paginates and reports the total number of matches', async () => {
    const all = await search('?q=a&limit=100');
    const page = await search('?q=a&limit=2&offset=1');

    expect(page.status).toBe(200);
    expect(page.body.limit).toBe(2);
    expect(page.body.offset).toBe(1);
    expect(page.body.total).toBe(all.body.total);
    expect(page.body.items).toEqual(all.body.items.slice(1, 3));
  });

  it('defaults to limit 20 and offset 0', async () => {
    const res = await search('?q=a');

    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(20);
    expect(res.body.offset).toBe(0);
    expect(res.body.items).toHaveLength(20);
    expect(res.body.total).toBeGreaterThan(20);
  });

  it.each([
    ['q is missing', ''],
    ['q is blank', '?q=%20%20'],
    ['limit is 0', '?q=a&limit=0'],
    ['limit is above 100', '?q=a&limit=101'],
    ['offset is negative', '?q=a&offset=-1'],
  ])('answers 400 when %s', async (_name, query) => {
    const res = await search(query);

    expect(res.status).toBe(400);
  });

  it('treats % in q literally', async () => {
    const res = await search('?q=%25');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ items: [], total: 0 });
  });

  it('serves a repeated request from the cache for 5 minutes', async () => {
    const first = await search('?q=%20PAMP%20&limit=5');
    expect(ctx.cache.entries.get('search:pamp:5:0')?.ttlSeconds).toBe(300);

    await ctx.pool.query("UPDATE instruments SET name = 'Changed' WHERE ticker = 'PAMP'");
    const second = await search('?q=pamp&limit=5');
    await ctx.pool.query(
      "UPDATE instruments SET name = 'Pampa Holding S.A.' WHERE ticker = 'PAMP'",
    );

    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
  });

  it('falls back to PostgreSQL when the cache is down', async () => {
    ctx.cache.failing = true;
    const res = await search('?q=PAMP');

    expect(res.status).toBe(200);
    expect(res.body.items[0].lastPrice).toBe('925.85');
  });
});
