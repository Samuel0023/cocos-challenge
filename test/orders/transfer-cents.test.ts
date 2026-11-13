import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../support/test-app.ts';
import { ARS, orderHelpers, PAMP } from './order-helpers.ts';

describe('POST /orders with cents', () => {
  let ctx: TestApp;
  const { post, countOrders, orderRow, newUser } = orderHelpers(() => ctx);

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(() => ctx.close());

  it('stores a CASH_IN by amount with its cents and answers size as a decimal string', async () => {
    const userId = await newUser();
    const res = await post({ userId, side: 'CASH_IN', amount: '2777.55' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      instrumentId: ARS,
      side: 'CASH_IN',
      status: 'FILLED',
      size: '2777.55',
      price: '1.00',
    });
    expect(await orderRow(res.body.id)).toMatchObject({ size: '2777.55', price: '1.00' });
  });

  it('stores a CASH_IN by size with cents', async () => {
    const userId = await newUser();
    const res = await post({ userId, side: 'CASH_IN', size: '0.50' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'FILLED', size: '0.50', price: '1.00' });
    expect((await orderRow(res.body.id))?.size).toBe('0.50');
  });

  it('fills a CASH_OUT of exactly the available cash and rejects one cent more', async () => {
    const userId = await newUser('100.25');
    const above = await post({ userId, side: 'CASH_OUT', amount: '100.26' });
    const exact = await post({ userId, side: 'CASH_OUT', size: 100.25 });

    expect(above.status).toBe(201);
    expect(above.body).toMatchObject({ status: 'REJECTED', size: '100.26' });
    expect(exact.status).toBe(201);
    expect(exact.body).toMatchObject({ status: 'FILLED', size: '100.25' });
    expect((await orderRow(exact.body.id))?.status).toBe('FILLED');
  });

  it.each([
    ['a transfer amount with three decimals', { side: 'CASH_IN', amount: '10.123' }],
    ['a transfer size with three decimals', { side: 'CASH_IN', size: '10.123' }],
    ['a fractional BUY size', { instrumentId: PAMP, side: 'BUY', type: 'MARKET', size: 1.5 }],
    [
      'a BUY size with cents as a string',
      { instrumentId: PAMP, side: 'BUY', type: 'MARKET', size: '1.50' },
    ],
  ])('answers 400 for %s and stores nothing', async (_name, body) => {
    const before = await countOrders();
    const res = await post({ userId: 2, ...body });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(await countOrders()).toBe(before);
  });

  it('lets the database reject a fractional BUY size', async () => {
    await expect(
      ctx.pool.query(
        `INSERT INTO orders (instrumentid, userid, size, price, side, status, type, datetime)
         VALUES ($1, 1, 1.5, 10, 'BUY', 'FILLED', 'MARKET', now())`,
        [PAMP],
      ),
    ).rejects.toMatchObject({ code: '23514', constraint: 'orders_whole_shares_check' });
  });

  it('replays a transfer with the same cents and answers 422 for different cents', async () => {
    const userId = await newUser();
    const key = randomUUID();
    const first = await post({ userId, side: 'CASH_IN', amount: '2777.55' }, key);
    const before = await countOrders();
    const same = await post({ userId, side: 'CASH_IN', amount: '2777.55' }, key);
    const other = await post({ userId, side: 'CASH_IN', amount: '2777.56' }, key);

    expect(first.status).toBe(201);
    expect(same.status).toBe(201);
    expect(same.body).toEqual(first.body);
    expect(other.status).toBe(422);
    expect(await countOrders()).toBe(before);
  });

  it('publishes the transfer event with size as a decimal string', async () => {
    const userId = await newUser();
    const res = await post({ userId, side: 'CASH_IN', amount: '2777.55' });
    const event = ctx.events.published.find((e) => e.order.id === res.body.id);

    expect(event?.order).toMatchObject({ side: 'CASH_IN', size: '2777.55', price: '1.00' });
  });
});
