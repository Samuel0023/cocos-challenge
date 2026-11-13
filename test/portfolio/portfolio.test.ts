import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../support/test-app.ts';

/*
 * User 1, from the seed in db/database.sql:
 * - Cash balance (FILLED): CASH_IN 1000000 − BUY PAMP 50×930 + SELL PAMP 10×940 − CASH_OUT 100000
 *   − BUY BMA 20×1540 + SELL BMA 30×1530 − BUY METR 500×250 = 753000.00.
 * - Reserved (NEW LIMIT BUY): 50×710 + 60×1500 = 125500.00; available 627500.00.
 * - PAMP (47): 50 − 10 = 40, average 930, close 925.85, previous 921.80.
 *   Market value 37034.00; total (925.85 − 930) / 930 = −0.446% → −0.45; daily 4.05 / 921.80 = 0.439% → 0.44.
 * - METR (54): 500, average 250, close 229.50, previous 232.00.
 *   Market value 114750.00; total −20.50 / 250 = −8.20; daily −2.50 / 232 = −1.077% → −1.08.
 * - BMA (31): 20 − 30 = −10, not listed.
 * - Total: 753000 + 37034 + 114750 = 904784.00.
 */
const user1 = {
  userId: 1,
  totalAccountValue: '904784.00',
  availableCash: '627500.00',
  cashBalance: '753000.00',
  reservedCash: '125500.00',
  positions: [
    {
      instrumentId: 54,
      ticker: 'METR',
      name: 'MetroGAS S.A.',
      quantity: 500,
      averageCost: '250.00',
      lastPrice: '229.50',
      marketValue: '114750.00',
      totalReturnPct: '-8.20',
      dailyReturnPct: '-1.08',
    },
    {
      instrumentId: 47,
      ticker: 'PAMP',
      name: 'Pampa Holding S.A.',
      quantity: 40,
      averageCost: '930.00',
      lastPrice: '925.85',
      marketValue: '37034.00',
      totalReturnPct: '-0.45',
      dailyReturnPct: '0.44',
    },
  ],
};

const insertOrder = (ctx: TestApp, side: string, size: number, price: string) =>
  ctx.pool.query(
    `INSERT INTO orders (instrumentid, userid, size, price, side, status, type, datetime)
     VALUES (47, 1, $1, $2, $3, 'NEW', 'LIMIT', now())`,
    [size, price, side],
  );

describe('GET /users/:userId/portfolio', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(() => ctx.close());

  it('returns the portfolio of user 1 from the seed', async () => {
    const res = await request(ctx.app).get('/users/1/portfolio');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(user1);
  });

  it('reads prices through the cache', () => {
    // Filled by the previous request.
    expect(ctx.cache.entries.has('quote:47')).toBe(true);
    expect(ctx.cache.entries.has('quote:54')).toBe(true);
  });

  it.each([2, 3, 4])(
    'returns zeros and no positions for user %i without orders',
    async (userId) => {
      const res = await request(ctx.app).get(`/users/${userId}/portfolio`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        userId,
        totalAccountValue: '0.00',
        availableCash: '0.00',
        cashBalance: '0.00',
        reservedCash: '0.00',
        positions: [],
      });
    },
  );

  it.each(['999', '99999999999'])('returns 404 for unknown user %s', async (userId) => {
    const res = await request(ctx.app).get(`/users/${userId}/portfolio`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it.each(['abc', '0', '-1', '1.5'])('returns 400 for user id "%s"', async (userId) => {
    const res = await request(ctx.app).get(`/users/${userId}/portfolio`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('answers 200 when the cache is down', async () => {
    ctx.cache.failing = true;
    try {
      const res = await request(ctx.app).get('/users/1/portfolio');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(user1);
    } finally {
      ctx.cache.failing = false;
    }
  });

  it('a NEW LIMIT BUY lowers available cash but not the total account value', async () => {
    await insertOrder(ctx, 'BUY', 10, '900.00');

    const res = await request(ctx.app).get('/users/1/portfolio');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      reservedCash: '134500.00',
      availableCash: '618500.00',
      cashBalance: '753000.00',
      totalAccountValue: '904784.00',
    });
  });

  it('a NEW LIMIT SELL does not change the quantity', async () => {
    await insertOrder(ctx, 'SELL', 5, '1000.00');

    const res = await request(ctx.app).get('/users/1/portfolio');

    expect(res.status).toBe(200);
    expect(res.body.positions.find((p: { ticker: string }) => p.ticker === 'PAMP').quantity).toBe(
      40,
    );
    expect(res.body.totalAccountValue).toBe('904784.00');
  });
});
