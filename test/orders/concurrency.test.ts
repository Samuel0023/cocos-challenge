import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../support/test-app.ts';
import { orderHelpers, PAMP, METR } from './order-helpers.ts';

describe('orders under concurrency', () => {
  let ctx: TestApp;
  const { post, countOrders, newUser } = orderHelpers(() => ctx);

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  async function slow<T>(fn: () => Promise<T>, secs = 0.2): Promise<T> {
    await ctx.pool.query(`
      CREATE OR REPLACE FUNCTION slow_orders() RETURNS trigger AS $$
      BEGIN PERFORM pg_sleep(${secs}); RETURN NEW; END $$ LANGUAGE plpgsql;
      CREATE TRIGGER slow_orders BEFORE INSERT OR UPDATE ON orders
        FOR EACH ROW EXECUTE FUNCTION slow_orders();`);
    try {
      return await fn();
    } finally {
      await ctx.pool.query('DROP TRIGGER slow_orders ON orders; DROP FUNCTION slow_orders();');
    }
  }

  const portfolio = async (userId: number) =>
    (await request(ctx.app).get(`/users/${userId}/portfolio`)).body;

  const price = async (id: number) => {
    const { rows } = await ctx.pool.query<{ close: string }>(
      'SELECT close::text FROM marketdata WHERE instrumentid = $1 ORDER BY date DESC LIMIT 1',
      [id],
    );
    return rows[0]!.close;
  };

  it('portfolio user 1 control case', async () => {
    const p = await portfolio(1);
    expect(p.cashBalance).toBe('753000.00');
    expect(p.availableCash).toBe('627500.00');
    expect(p.totalAccountValue).toBe('904784.00');
    expect(
      p.positions.map((x: { ticker: string; quantity: number }) => [x.ticker, x.quantity]),
    ).toEqual([
      ['METR', 500],
      ['PAMP', 40],
    ]);
  });

  it('N parallel BUYs never overspend', async () => {
    const close = await price(PAMP);
    const cents = Math.round(Number(close) * 100) * 3; // 3 shares
    const userId = await newUser(String(Math.ceil(cents / 100))); // transfers truncate cents
    const body = { userId, instrumentId: PAMP, side: 'BUY', type: 'MARKET', size: 1 };
    const res = await slow(() => Promise.all(Array.from({ length: 8 }, () => post(body))));
    expect(res.every((r) => r.status === 201)).toBe(true);
    expect(res.filter((r) => r.body.status === 'FILLED')).toHaveLength(3);
    const p = await portfolio(userId);
    expect(Math.round(Number(p.availableCash) * 100)).toBe(Math.ceil(cents / 100) * 100 - cents);
  });

  it('parallel BUY + CASH_OUT never overspend', async () => {
    const userId = await newUser('1000');
    const close = await price(PAMP);
    const size = Math.floor(1000 / Number(close));
    const res = await slow(() =>
      Promise.all([
        post({ userId, instrumentId: PAMP, side: 'BUY', type: 'MARKET', size }),
        post({ userId, side: 'CASH_OUT', amount: '1000' }),
      ]),
    );
    expect(res.map((r) => r.body.status).sort()).toEqual(['FILLED', 'REJECTED']);
    expect(Number((await portfolio(userId)).availableCash)).toBeGreaterThanOrEqual(0);
  });

  it('parallel SELLs of the same holding never oversell', async () => {
    const userId = await newUser('100000');
    expect(
      (await post({ userId, instrumentId: METR, side: 'BUY', type: 'MARKET', size: 5 })).body
        .status,
    ).toBe('FILLED');
    const body = { userId, instrumentId: METR, side: 'SELL', type: 'MARKET', size: 2 };
    const res = await slow(() => Promise.all(Array.from({ length: 5 }, () => post(body))));
    expect(res.filter((r) => r.body.status === 'FILLED')).toHaveLength(2);
    const p = await portfolio(userId);
    expect(p.positions.find((x: { ticker: string }) => x.ticker === 'METR')?.quantity).toBe(1);
  });

  it('LIMIT + MARKET mix honours reservations under concurrency', async () => {
    const userId = await newUser('1000');
    const res = await slow(() =>
      Promise.all([
        post({ userId, instrumentId: PAMP, side: 'BUY', type: 'LIMIT', size: 1, price: '600' }),
        post({ userId, instrumentId: PAMP, side: 'BUY', type: 'LIMIT', size: 1, price: '600' }),
        post({ userId, side: 'CASH_OUT', amount: '600' }),
      ]),
    );
    const accepted = res.filter((r) => ['NEW', 'FILLED'].includes(r.body.status));
    expect(accepted).toHaveLength(1);
    expect(Number((await portfolio(userId)).availableCash)).toBeGreaterThanOrEqual(0);
  });

  it('cancel racing cancel: one 200, one 409, one event', async () => {
    const userId = await newUser('1000');
    const o = await post({
      userId,
      instrumentId: PAMP,
      side: 'BUY',
      type: 'LIMIT',
      size: 1,
      price: '500',
    });
    const before = ctx.events.published.length;
    const res = await slow(() =>
      Promise.all([
        request(ctx.app).post(`/orders/${o.body.id}/cancel`),
        request(ctx.app).post(`/orders/${o.body.id}/cancel`),
      ]),
    );
    expect(res.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      ctx.events.published.slice(before).filter((e) => e.type === 'order.cancelled'),
    ).toHaveLength(1);
  });

  it('cancel racing a submit that needs the freed reservation stays consistent', async () => {
    for (let i = 0; i < 3; i++) {
      const userId = await newUser('1000');
      const o = await post({
        userId,
        instrumentId: PAMP,
        side: 'BUY',
        type: 'LIMIT',
        size: 1,
        price: '1000',
      });
      expect(o.body.status).toBe('NEW');
      const [c, s] = await slow(() =>
        Promise.all([
          request(ctx.app).post(`/orders/${o.body.id}/cancel`),
          post({ userId, side: 'CASH_OUT', amount: '1000' }),
        ]),
      );
      expect(c.status).toBe(200);
      expect(['FILLED', 'REJECTED']).toContain(s.body.status);
      const p = await portfolio(userId);
      expect(Number(p.availableCash)).toBeGreaterThanOrEqual(0);
      expect(p.availableCash).toBe(s.body.status === 'FILLED' ? '0.00' : '1000.00');
    }
  });

  it('two users and submit/cancel interleavings do not deadlock', async () => {
    const a = await newUser('100000');
    const b = await newUser('100000');
    const lim = await post({
      userId: a,
      instrumentId: PAMP,
      side: 'BUY',
      type: 'LIMIT',
      size: 1,
      price: '10',
    });
    const ops: PromiseLike<{ status: number }>[] = [];
    for (let i = 0; i < 6; i++) {
      ops.push(post({ userId: a, instrumentId: PAMP, side: 'BUY', type: 'MARKET', size: 1 }));
      ops.push(post({ userId: b, instrumentId: PAMP, side: 'BUY', type: 'MARKET', size: 1 }));
    }
    ops.push(request(ctx.app).post(`/orders/${lim.body.id}/cancel`));
    const res = await slow(() => Promise.all(ops), 0.05);
    expect(res.every((r) => r.status === 201 || r.status === 200)).toBe(true);
  });

  it('N concurrent duplicates of one key store one row and publish once', async () => {
    const userId = await newUser('10000');
    const key = randomUUID();
    const body = { userId, instrumentId: PAMP, side: 'BUY', type: 'MARKET', size: 1 };
    const before = await countOrders();
    const evBefore = ctx.events.published.length;
    const res = await slow(() => Promise.all(Array.from({ length: 6 }, () => post(body, key))));
    expect(res.every((r) => r.status === 201)).toBe(true);
    expect(new Set(res.map((r) => r.body.id)).size).toBe(1);
    expect(await countOrders()).toBe(before + 1);
    expect(ctx.events.published.length - evBefore).toBe(1);
  });

  it('4xx answers never change the orders count', async () => {
    const userId = await newUser('10000');
    const key = randomUUID();
    await post({ userId, instrumentId: PAMP, side: 'BUY', type: 'MARKET', size: 1 }, key);
    const before = await countOrders();
    const bad = [
      post({ userId, instrumentId: PAMP, side: 'BUY', type: 'MARKET', size: 2 }, key),
      post({ userId: 999999, instrumentId: PAMP, side: 'BUY', type: 'MARKET', size: 1 }),
      post({ userId, instrumentId: 66, side: 'BUY', type: 'MARKET', size: 1 }),
      post({ userId, side: 'CASH_IN', amount: '0.5' }),
      post({ userId, instrumentId: PAMP, side: 'BUY', type: 'LIMIT', size: 1, price: '0.001' }),
      post({ userId, instrumentId: PAMP, side: 'BUY', type: 'LIMIT', size: 1, price: 1e21 }),
    ];
    const res = await Promise.all(bad);
    for (const r of res) expect(r.status, JSON.stringify(r.body)).toBeGreaterThanOrEqual(400);
    for (const r of res) expect(r.status, JSON.stringify(r.body)).toBeLessThan(500);
    expect(await countOrders()).toBe(before);
  });

  it('a BUY whose total exceeds NUMERIC range is answered, not 500', async () => {
    const userId = await newUser('10000');
    const r = await post({
      userId,
      instrumentId: PAMP,
      side: 'BUY',
      type: 'LIMIT',
      size: 2147483647,
      price: '99999999.99',
    });
    expect(r.status).toBeLessThan(500);
  });
});
