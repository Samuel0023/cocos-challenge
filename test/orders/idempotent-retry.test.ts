import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../support/test-app.ts';
import { orderHelpers, PAMP } from './order-helpers.ts';

describe('POST /orders retried after the market price moved', () => {
  let ctx: TestApp;
  const { post, newUser, countOrders } = orderHelpers(() => ctx);

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(() => ctx.close());

  const movePrice = async (close: string) => {
    await ctx.pool.query('UPDATE marketdata SET close = $1 WHERE instrumentid = $2', [close, PAMP]);
    ctx.cache.entries.clear();
  };

  it('returns the stored MARKET order instead of comparing against the new price', async () => {
    const userId = await newUser('100000');
    const key = randomUUID();
    const body = { userId, instrumentId: PAMP, side: 'BUY', type: 'MARKET', size: 2 };

    const first = await post(body, key);
    await movePrice('950.00');
    const before = await countOrders();
    const retry = await post(body, key);

    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.body).toEqual(first.body);
    expect(await countOrders()).toBe(before);
  });

  it('returns the stored order for a MARKET order by amount', async () => {
    const userId = await newUser('100000');
    const key = randomUUID();
    const body = { userId, instrumentId: PAMP, side: 'BUY', type: 'MARKET', amount: '20000' };

    const first = await post(body, key);
    await movePrice('400.00');
    const retry = await post(body, key);

    expect(retry.status).toBe(201);
    expect(retry.body).toEqual(first.body);
  });

  it('returns the stored order when the price rose until the amount buys no share', async () => {
    const userId = await newUser('100000');
    const key = randomUUID();
    const body = { userId, instrumentId: PAMP, side: 'BUY', type: 'MARKET', amount: '1000' };

    await movePrice('925.85');
    const first = await post(body, key);
    await movePrice('1500.00');
    const ordersBefore = await countOrders();
    const eventsBefore = ctx.events.published.length;
    const retry = await post(body, key);

    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ status: 'FILLED', size: 1 });
    expect(retry.status).toBe(201);
    expect(retry.body).toEqual(first.body);
    expect(await countOrders()).toBe(ordersBefore);
    expect(ctx.events.published).toHaveLength(eventsBefore);
  });

  it('still answers 422 to a first request whose amount buys no share', async () => {
    const userId = await newUser('100000');
    await movePrice('1500.00');
    const before = await countOrders();

    const res = await post({
      userId,
      instrumentId: PAMP,
      side: 'BUY',
      type: 'MARKET',
      amount: '1000',
    });

    expect(res.status).toBe(422);
    expect(await countOrders()).toBe(before);
  });

  it('still answers 422 when the same key asks for a different size', async () => {
    const userId = await newUser('100000');
    const key = randomUUID();

    await post({ userId, instrumentId: PAMP, side: 'BUY', type: 'MARKET', size: 2 }, key);
    const other = await post(
      { userId, instrumentId: PAMP, side: 'BUY', type: 'MARKET', size: 3 },
      key,
    );

    expect(other.status).toBe(422);
  });
});
