import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../support/test-app.ts';
import { orderHelpers } from './order-helpers.ts';

/** Largest transfer the `orders.size` column holds: NUMERIC(20, 2). */
const MAX_TRANSFER = '999999999999999999.99';

describe('POST /orders with a balance above one transfer', () => {
  let ctx: TestApp;
  const { post, orderRow, newUser } = orderHelpers(() => ctx);

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(() => ctx.close());

  it('keeps accepting orders when the cash balance exceeds the size column', async () => {
    const userId = await newUser(MAX_TRANSFER);
    expect((await post({ userId, side: 'CASH_IN', amount: MAX_TRANSFER })).status).toBe(201);

    const res = await post({ userId, side: 'CASH_OUT', amount: '1.50' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ side: 'CASH_OUT', status: 'FILLED', size: '1.50' });
    expect(await orderRow(res.body.id)).toMatchObject({ status: 'FILLED', size: '1.50' });
  });

  it('still rejects a CASH_OUT above that balance', async () => {
    const userId = await newUser('10.00');

    const res = await post({ userId, side: 'CASH_OUT', amount: '10.01' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('REJECTED');
  });
});
