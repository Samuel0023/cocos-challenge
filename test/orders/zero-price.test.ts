import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../support/test-app.ts';
import { orderHelpers, PAMP } from './order-helpers.ts';

describe('POST /orders on an instrument whose latest close is 0', () => {
  let ctx: TestApp;
  const { post, newUser, countOrders } = orderHelpers(() => ctx);

  beforeAll(async () => {
    ctx = await createTestApp();
    await ctx.pool.query('UPDATE marketdata SET close = 0 WHERE instrumentid = $1', [PAMP]);
  });

  afterAll(() => ctx.close());

  it.each([{ size: 1 }, { amount: '1000' }])(
    'answers 422 to a MARKET BUY by %o and stores nothing',
    async (sizing) => {
      const userId = await newUser('100000');
      const before = await countOrders();
      const eventsBefore = ctx.events.published.length;

      const res = await post({
        userId,
        instrumentId: PAMP,
        side: 'BUY',
        type: 'MARKET',
        ...sizing,
      });

      expect(res.status).toBe(422);
      expect(res.body.error).toMatchObject({
        code: 'UNPROCESSABLE_ENTITY',
        message: 'Instrument PAMP has no market price to trade at',
      });
      expect(await countOrders()).toBe(before);
      expect(ctx.events.published).toHaveLength(eventsBefore);
    },
  );

  it('still accepts a LIMIT order, which brings its own price', async () => {
    const userId = await newUser('100000');

    const res = await post({
      userId,
      instrumentId: PAMP,
      side: 'BUY',
      type: 'LIMIT',
      size: 1,
      price: '900',
    });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('NEW');
  });
});
