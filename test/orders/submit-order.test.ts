import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../support/test-app.ts';
import { ARS, METR, orderHelpers, PAMP } from './order-helpers.ts';

const PGR = 3;

describe('POST /orders', () => {
  let ctx: TestApp;
  const { post, countOrders, orderRow, newUser, shares } = orderHelpers(() => ctx);

  beforeAll(async () => {
    ctx = await createTestApp();
    const { rows } = await ctx.pool.query<{ id: number }>(
      "SELECT id FROM instruments WHERE ticker = 'PGR'",
    );
    expect(rows[0]?.id).toBe(PGR);
  });

  afterAll(() => ctx.close());

  afterEach(() => {
    ctx.cache.failing = false;
  });

  /** Asserts the request stores nothing and answers with `status`. */
  async function expectRejectedRequest(
    body: unknown,
    status: number,
    key: string | null = randomUUID(),
  ) {
    const before = await countOrders();
    const req = request(ctx.app).post('/orders');
    const res = await (key === null ? req : req.set('Idempotency-Key', key)).send(body as object);
    expect(res.status).toBe(status);
    expect(res.body.error).toBeDefined();
    expect(await countOrders()).toBe(before);
    return res;
  }

  describe('market and limit orders', () => {
    it('fills a MARKET BUY with funds at the last close', async () => {
      const userId = await newUser('10000');
      const res = await post({ userId, instrumentId: PAMP, side: 'BUY', type: 'MARKET', size: 2 });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        id: expect.any(Number),
        userId,
        instrumentId: PAMP,
        side: 'BUY',
        type: 'MARKET',
        status: 'FILLED',
        size: 2,
        price: '925.85',
        datetime: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      });
      const row = await orderRow(res.body.id);
      expect(row).toMatchObject({
        userid: userId,
        instrumentid: PAMP,
        side: 'BUY',
        type: 'MARKET',
        status: 'FILLED',
        size: 2,
        price: '925.85',
      });
    });

    it('stores a MARKET BUY without funds as REJECTED', async () => {
      const userId = await newUser('1000');
      const res = await post({ userId, instrumentId: PAMP, side: 'BUY', type: 'MARKET', size: 2 });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'REJECTED', size: 2, price: '925.85' });
      expect((await orderRow(res.body.id))?.status).toBe('REJECTED');
    });

    it('leaves a LIMIT BUY with funds NEW and reserves its cash', async () => {
      const userId = await newUser('2000');
      const limit = await post({
        userId,
        instrumentId: PAMP,
        side: 'BUY',
        type: 'LIMIT',
        size: 1,
        price: '1500',
      });
      expect(limit.status).toBe(201);
      expect(limit.body).toMatchObject({ status: 'NEW', type: 'LIMIT', price: '1500.00' });
      expect((await orderRow(limit.body.id))?.status).toBe('NEW');

      // 925.85 fits in 2000 but not in the 500 left after the reservation.
      const market = await post({
        userId,
        instrumentId: PAMP,
        side: 'BUY',
        type: 'MARKET',
        size: 1,
      });
      expect(market.status).toBe(201);
      expect(market.body.status).toBe('REJECTED');
      expect((await orderRow(market.body.id))?.status).toBe('REJECTED');
    });

    it('rejects a second LIMIT BUY above what the first reservation leaves', async () => {
      const userId = await newUser('2000');
      const first = await post({
        userId,
        instrumentId: PAMP,
        side: 'BUY',
        type: 'LIMIT',
        size: 1,
        price: 1500,
      });
      const second = await post({
        userId,
        instrumentId: PAMP,
        side: 'BUY',
        type: 'LIMIT',
        size: 1,
        price: '500.01',
      });

      expect(first.body.status).toBe('NEW');
      expect(second.status).toBe(201);
      expect(second.body).toMatchObject({ status: 'REJECTED', price: '500.01' });
      expect((await orderRow(second.body.id))?.status).toBe('REJECTED');
    });

    it('fills a MARKET SELL with holdings and reduces the position', async () => {
      expect(await shares(1, PAMP)).toBe(40);
      const res = await post({
        userId: 1,
        instrumentId: PAMP,
        side: 'SELL',
        type: 'MARKET',
        size: 5,
      });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ side: 'SELL', status: 'FILLED', size: 5, price: '925.85' });
      expect((await orderRow(res.body.id))?.status).toBe('FILLED');
      expect(await shares(1, PAMP)).toBe(35);
    });

    it('rejects a SELL of more shares than available', async () => {
      const res = await post({
        userId: 1,
        instrumentId: METR,
        side: 'SELL',
        type: 'MARKET',
        size: 501,
      });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'REJECTED', price: '229.50' });
      expect((await orderRow(res.body.id))?.status).toBe('REJECTED');
      expect(await shares(1, METR)).toBe(500);
    });

    it('reserves shares with a NEW LIMIT SELL', async () => {
      const userId = await newUser('10000');
      await post({ userId, instrumentId: PAMP, side: 'BUY', type: 'MARKET', size: 3 });
      const limit = await post({
        userId,
        instrumentId: PAMP,
        side: 'SELL',
        type: 'LIMIT',
        size: 2,
        price: '1000',
      });
      const market = await post({
        userId,
        instrumentId: PAMP,
        side: 'SELL',
        type: 'MARKET',
        size: 2,
      });

      expect(limit.body.status).toBe('NEW');
      expect(market.status).toBe(201);
      expect(market.body.status).toBe('REJECTED');
      expect((await orderRow(market.body.id))?.status).toBe('REJECTED');
    });

    it('buys by amount the whole shares it covers at the last close', async () => {
      const userId = await newUser('10000');
      const res = await post({
        userId,
        instrumentId: PAMP,
        side: 'BUY',
        type: 'MARKET',
        amount: '5000',
      });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'FILLED', size: 5, price: '925.85' });
      expect((await orderRow(res.body.id))?.size).toBe(5);
    });

    it('answers 422 when the amount does not cover one share', async () => {
      const userId = await newUser('10000');
      await expectRejectedRequest(
        { userId, instrumentId: PAMP, side: 'BUY', type: 'MARKET', amount: 925.84 },
        422,
      );
    });

    it('fills a MARKET BUY at the PostgreSQL price when the cache is down', async () => {
      const userId = await newUser('10000');
      ctx.cache.failing = true;
      const res = await post({ userId, instrumentId: PAMP, side: 'BUY', type: 'MARKET', size: 1 });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'FILLED', price: '925.85' });
      expect((await orderRow(res.body.id))?.price).toBe('925.85');
    });
  });

  describe('validation', () => {
    it.each([
      ['LIMIT without price', { side: 'BUY', type: 'LIMIT', size: 1 }],
      ['MARKET with price', { side: 'BUY', type: 'MARKET', size: 1, price: '10' }],
      ['size and amount together', { side: 'BUY', type: 'MARKET', size: 1, amount: '1000' }],
      ['neither size nor amount', { side: 'BUY', type: 'MARKET' }],
      ['size 0', { side: 'BUY', type: 'MARKET', size: 0 }],
      ['fractional size', { side: 'BUY', type: 'MARKET', size: 1.5 }],
      ['negative amount', { side: 'BUY', type: 'MARKET', amount: '-10' }],
      ['amount with three decimals', { side: 'BUY', type: 'MARKET', amount: '10.123' }],
      ['unknown side', { side: 'SHORT', type: 'MARKET', size: 1 }],
      ['missing type on a BUY', { side: 'BUY', size: 1 }],
      ['LIMIT on a transfer', { side: 'CASH_IN', type: 'LIMIT', size: 1, price: '1' }],
    ])('answers 400 for %s', async (_name, body) => {
      await expectRejectedRequest({ userId: 2, instrumentId: PAMP, ...body }, 400);
    });

    it('answers 400 when userId or instrumentId is missing', async () => {
      await expectRejectedRequest(
        { instrumentId: PAMP, side: 'BUY', type: 'MARKET', size: 1 },
        400,
      );
      await expectRejectedRequest({ userId: 2, side: 'BUY', type: 'MARKET', size: 1 }, 400);
    });

    it('answers 400 without an Idempotency-Key or with one that is not a UUID', async () => {
      const body = { userId: 2, instrumentId: PAMP, side: 'BUY', type: 'MARKET', size: 1 };
      await expectRejectedRequest(body, 400, null);
      await expectRejectedRequest(body, 400, 'not-a-uuid');
    });

    it('answers 404 for an unknown instrument or user', async () => {
      await expectRejectedRequest(
        { userId: 2, instrumentId: 99999, side: 'BUY', type: 'MARKET', size: 1 },
        404,
      );
      await expectRejectedRequest(
        { userId: 99999, instrumentId: PAMP, side: 'BUY', type: 'MARKET', size: 1 },
        404,
      );
    });

    it('answers 422 for a MARKET order on an instrument without market data', async () => {
      await expectRejectedRequest(
        { userId: 1, instrumentId: PGR, side: 'BUY', type: 'MARKET', size: 1 },
        422,
      );
    });

    it('answers 422 for a BUY on the ARS instrument and a transfer on another one', async () => {
      await expectRejectedRequest(
        { userId: 1, instrumentId: ARS, side: 'BUY', type: 'LIMIT', size: 1, price: '1' },
        422,
      );
      await expectRejectedRequest({ userId: 1, instrumentId: PAMP, side: 'CASH_IN', size: 1 }, 422);
    });
  });

  describe('transfers', () => {
    it('fills a CASH_IN for a user without movements and then a BUY', async () => {
      const userId = await newUser();
      const cashIn = await post({ userId, side: 'CASH_IN', amount: '1500.75' });

      expect(cashIn.status).toBe(201);
      expect(cashIn.body).toMatchObject({
        userId,
        instrumentId: ARS,
        side: 'CASH_IN',
        type: 'MARKET',
        status: 'FILLED',
        size: 1500,
        price: '1.00',
      });
      expect(await orderRow(cashIn.body.id)).toMatchObject({ instrumentid: ARS, size: 1500 });

      const buy = await post({ userId, instrumentId: PAMP, side: 'BUY', type: 'MARKET', size: 1 });
      expect(buy.status).toBe(201);
      expect(buy.body.status).toBe('FILLED');
      expect((await orderRow(buy.body.id))?.status).toBe('FILLED');
    });

    it('rejects a CASH_OUT above the balance and fills one within it', async () => {
      const userId = await newUser('1000');
      const above = await post({ userId, side: 'CASH_OUT', instrumentId: ARS, size: 1001 });
      const within = await post({ userId, side: 'CASH_OUT', type: 'MARKET', size: 1000 });

      expect(above.status).toBe(201);
      expect(above.body).toMatchObject({ side: 'CASH_OUT', status: 'REJECTED', size: 1001 });
      expect((await orderRow(above.body.id))?.status).toBe('REJECTED');
      expect(within.status).toBe(201);
      expect(within.body.status).toBe('FILLED');
      expect((await orderRow(within.body.id))?.status).toBe('FILLED');
    });
  });

  describe('concurrency and idempotency', () => {
    it('fills only one of two simultaneous BUYs that together exceed the balance', async () => {
      const userId = await newUser('1000');
      const body = { userId, instrumentId: PAMP, side: 'BUY', type: 'MARKET', size: 1 };
      // Slow inserts widen the gap between the balance check and the commit, so without the
      // user row lock both requests would read the same balance and both fill.
      await ctx.pool.query(`
        CREATE FUNCTION slow_insert() RETURNS trigger AS $$
        BEGIN PERFORM pg_sleep(0.3); RETURN NEW; END $$ LANGUAGE plpgsql;
        CREATE TRIGGER slow_insert BEFORE INSERT ON orders
          FOR EACH ROW EXECUTE FUNCTION slow_insert();`);
      let results;
      try {
        results = await Promise.all([post(body), post(body)]);
      } finally {
        await ctx.pool.query('DROP TRIGGER slow_insert ON orders; DROP FUNCTION slow_insert();');
      }

      expect(results.map((r) => r.status)).toEqual([201, 201]);
      expect(results.map((r) => r.body.status).sort()).toEqual(['FILLED', 'REJECTED']);
      const { rows } = await ctx.pool.query<{ status: string }>(
        "SELECT status FROM orders WHERE userid = $1 AND side = 'BUY' ORDER BY status",
        [userId],
      );
      expect(rows.map((r) => r.status)).toEqual(['FILLED', 'REJECTED']);
    });

    it('returns the same order for a repeated Idempotency-Key and stores it once', async () => {
      const userId = await newUser('10000');
      const key = randomUUID();
      const body = { userId, instrumentId: PAMP, side: 'BUY', type: 'MARKET', amount: '2000' };
      const before = await countOrders();

      const first = await post(body, key);
      const second = await post(body, key);

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body).toEqual(first.body);
      expect(await countOrders()).toBe(before + 1);
      expect((await orderRow(first.body.id))?.clientorderid).toBe(key);
      expect(ctx.events.published.filter((e) => e.order.id === first.body.id)).toHaveLength(1);
    });

    it('answers 422 for a reused Idempotency-Key with a different body', async () => {
      const userId = await newUser('10000');
      const key = randomUUID();
      await post({ userId, instrumentId: PAMP, side: 'BUY', type: 'MARKET', size: 1 }, key);

      await expectRejectedRequest(
        { userId, instrumentId: PAMP, side: 'BUY', type: 'MARKET', size: 2 },
        422,
        key,
      );
    });

    it('returns the same REJECTED order when a rejected order is retried', async () => {
      const userId = await newUser('100');
      const key = randomUUID();
      const body = { userId, instrumentId: PAMP, side: 'BUY', type: 'MARKET', size: 1 };
      const first = await post(body, key);
      const before = await countOrders();
      const retry = await post(body, key);

      expect(first.body.status).toBe('REJECTED');
      expect(retry.status).toBe(201);
      expect(retry.body).toEqual(first.body);
      expect(await countOrders()).toBe(before);
    });

    it('stores one order for two simultaneous requests with the same key', async () => {
      const userId = await newUser('10000');
      const key = randomUUID();
      const body = { userId, instrumentId: PAMP, side: 'BUY', type: 'MARKET', size: 1 };
      const [a, b] = await Promise.all([post(body, key), post(body, key)]);

      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(a.body.id).toBe(b.body.id);
      const { rows } = await ctx.pool.query(
        'SELECT id FROM orders WHERE userid = $1 AND clientorderid = $2',
        [userId, key],
      );
      expect(rows).toHaveLength(1);
    });
  });

  describe('events', () => {
    it('publishes order.created with the final status after each stored order', async () => {
      const userId = await newUser('1000');
      const filled = await post({
        userId,
        instrumentId: PAMP,
        side: 'BUY',
        type: 'MARKET',
        size: 1,
      });
      const rejected = await post({
        userId,
        instrumentId: PAMP,
        side: 'BUY',
        type: 'MARKET',
        size: 1,
      });

      for (const res of [filled, rejected]) {
        const event = ctx.events.published.find((e) => e.order.id === res.body.id);
        expect(event).toEqual({
          eventId: expect.stringMatching(/^[0-9a-f-]{36}$/),
          type: 'order.created',
          occurredAt: expect.any(String),
          order: {
            id: res.body.id,
            userId,
            instrumentId: PAMP,
            side: 'BUY',
            type: 'MARKET',
            status: res.body.status,
            size: 1,
            price: '925.85',
          },
        });
      }
      expect([filled.body.status, rejected.body.status]).toEqual(['FILLED', 'REJECTED']);
    });

    it('still answers 201 when the publisher throws', async () => {
      const failing = await createTestApp({
        eventPublisher: { publish: () => Promise.reject(new Error('SNS down')) },
      });
      try {
        const res = await request(failing.app)
          .post('/orders')
          .set('Idempotency-Key', randomUUID())
          .send({ userId: 1, side: 'CASH_IN', amount: '10' });

        expect(res.status).toBe(201);
        expect(res.body.status).toBe('FILLED');
        const { rows } = await failing.pool.query('SELECT status FROM orders WHERE id = $1', [
          res.body.id,
        ]);
        expect(rows[0]?.status).toBe('FILLED');
      } finally {
        await failing.close();
      }
    });
  });
});
