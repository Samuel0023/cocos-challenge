import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../support/test-app.ts';

describe('request body errors', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(() => ctx.close());

  const countOrders = async () => {
    const { rows } = await ctx.pool.query<{ count: string }>('SELECT count(*) FROM orders');
    return Number(rows[0]?.count);
  };

  it('answers 413 to a body above the JSON limit and stores nothing', async () => {
    const before = await countOrders();

    const res = await request(ctx.app)
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .send({ userId: 1, side: 'CASH_IN', amount: '1', padding: 'x'.repeat(200_000) });

    expect(res.status).toBe(413);
    expect(res.body).toEqual({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' },
    });
    expect(await countOrders()).toBe(before);
  });

  it('answers 415 to a body in an unsupported charset and stores nothing', async () => {
    const before = await countOrders();

    const res = await request(ctx.app)
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .set('Content-Type', 'application/json; charset=klingon')
      .send('{"userId":1,"side":"CASH_IN","amount":"1"}');

    expect(res.status).toBe(415);
    expect(res.body).toEqual({
      error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Unsupported request body encoding' },
    });
    expect(await countOrders()).toBe(before);
  });

  it('still answers 400 to malformed JSON', async () => {
    const res = await request(ctx.app)
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .set('Content-Type', 'application/json')
      .send('{"userId":');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: 'BAD_REQUEST', message: 'Malformed JSON body' } });
  });
});
