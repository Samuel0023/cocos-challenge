import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../support/test-app.ts';
import { orderHelpers, PAMP } from './order-helpers.ts';

describe('POST /orders/:orderId/cancel', () => {
  let ctx: TestApp;
  const { post, countOrders, orderRow, newUser } = orderHelpers(() => ctx);

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(() => ctx.close());

  const cancel = (id: number | string) => request(ctx.app).post(`/orders/${id}/cancel`);

  it('cancels a NEW order, publishes order.cancelled and frees the reservation', async () => {
    const userId = await newUser('2000');
    const limit = await post({
      userId,
      instrumentId: PAMP,
      side: 'BUY',
      type: 'LIMIT',
      size: 1,
      price: '1500',
    });
    expect(limit.body.status).toBe('NEW');

    const res = await cancel(limit.body.id);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ...limit.body, status: 'CANCELLED' });
    expect((await orderRow(limit.body.id))?.status).toBe('CANCELLED');
    const events = ctx.events.published.filter((e) => e.order.id === limit.body.id);
    expect(events.map((e) => [e.type, e.order.status])).toEqual([
      ['order.created', 'NEW'],
      ['order.cancelled', 'CANCELLED'],
    ]);

    // 925.85 only fits once the 1500 reservation is gone.
    const market = await post({ userId, instrumentId: PAMP, side: 'BUY', type: 'MARKET', size: 1 });
    expect(market.body.status).toBe('FILLED');
  });

  it('answers 409 when the order was already cancelled', async () => {
    const userId = await newUser('2000');
    const limit = await post({
      userId,
      instrumentId: PAMP,
      side: 'BUY',
      type: 'LIMIT',
      size: 1,
      price: '100',
    });
    await cancel(limit.body.id);
    const published = ctx.events.published.length;

    const res = await cancel(limit.body.id);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect((await orderRow(limit.body.id))?.status).toBe('CANCELLED');
    expect(ctx.events.published).toHaveLength(published);
  });

  it('answers 409 for a FILLED order and leaves it unchanged', async () => {
    const userId = await newUser('2000');
    const filled = await post({ userId, instrumentId: PAMP, side: 'BUY', type: 'MARKET', size: 1 });

    const res = await cancel(filled.body.id);

    expect(res.status).toBe(409);
    expect((await orderRow(filled.body.id))?.status).toBe('FILLED');
  });

  it.each(['999999', '99999999999'])('answers 404 for unknown order %s', async (orderId) => {
    const before = await countOrders();

    const res = await cancel(orderId);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(await countOrders()).toBe(before);
  });

  it.each(['abc', '0', '-1', '1.5'])('answers 400 for order id "%s"', async (orderId) => {
    const before = await countOrders();

    const res = await cancel(orderId);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(await countOrders()).toBe(before);
  });
});
