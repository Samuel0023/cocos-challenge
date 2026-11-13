import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../support/test-app.ts';
import { orderHelpers, PAMP } from './order-helpers.ts';

describe('POST /orders transfers take pesos in amount only', () => {
  let ctx: TestApp;
  const { post, countOrders, orderRow, newUser } = orderHelpers(() => ctx);

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(() => ctx.close());

  it.each(['CASH_IN', 'CASH_OUT'])('rejects a %s sent with size', async (side) => {
    const userId = await newUser('1000');
    const before = await countOrders();

    const res = await post({ userId, side, size: 100 });

    expect(res.status).toBe(400);
    expect(await countOrders()).toBe(before);
  });

  it('stores a transfer above the old limits exactly', async () => {
    const userId = await newUser();

    const res = await post({ userId, side: 'CASH_IN', amount: '5000000000.25' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'FILLED', size: '5000000000.25' });
    expect(await orderRow(res.body.id)).toMatchObject({ size: '5000000000.25' });
  });

  it('accepts the largest amount the size column holds and rejects one cent more', async () => {
    const userId = await newUser();
    const before = await countOrders();

    const over = await post({ userId, side: 'CASH_IN', amount: '1000000000000000000.00' });
    const max = await post({ userId, side: 'CASH_IN', amount: '999999999999999999.99' });

    expect(over.status).toBe(400);
    expect(max.status).toBe(201);
    expect(max.body.size).toBe('999999999999999999.99');
    expect(await countOrders()).toBe(before + 1);
  });

  it('keeps the price-column limit for a BUY by amount', async () => {
    const userId = await newUser('1000');
    const before = await countOrders();

    const res = await post({
      userId,
      instrumentId: PAMP,
      side: 'BUY',
      type: 'MARKET',
      amount: '100000000.00',
    });

    expect(res.status).toBe(400);
    expect(await countOrders()).toBe(before);
  });
});
