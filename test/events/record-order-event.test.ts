import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgOrderEventStore } from '../../src/events/pg-order-event-store.ts';
import { RecordOrderEvent } from '../../src/events/record-order-event.ts';
import type { OrderEvent } from '../../src/shared/events/order-event.ts';
import { createTestApp, type TestApp } from '../support/test-app.ts';

const event: OrderEvent = {
  eventId: '0b0f6a52-6d0c-4d58-9a55-0c1f3a1b2c3d',
  type: 'order.created',
  occurredAt: '2026-11-13T12:00:00.000Z',
  order: {
    id: 12,
    userId: 1,
    instrumentId: 47,
    side: 'BUY',
    type: 'MARKET',
    status: 'FILLED',
    size: 10,
    price: '925.85',
  },
};

describe('RecordOrderEvent', () => {
  let ctx: TestApp;
  let record: RecordOrderEvent;

  beforeAll(async () => {
    ctx = await createTestApp();
    record = new RecordOrderEvent(new PgOrderEventStore(ctx.pool));
  });

  afterAll(() => ctx.close());

  it('stores the event in analytics.order_events', async () => {
    await record.execute(JSON.stringify(event));

    const { rows } = await ctx.pool.query(
      'SELECT event_id, event_type, order_id, user_id, payload, occurred_at FROM analytics.order_events',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      event_id: event.eventId,
      event_type: 'order.created',
      order_id: 12,
      user_id: 1,
      payload: event,
    });
    expect(rows[0].occurred_at.toISOString()).toBe(event.occurredAt);
  });

  it('ignores a redelivery of the same event', async () => {
    await record.execute(JSON.stringify(event));

    const { rows } = await ctx.pool.query('SELECT count(*)::int AS n FROM analytics.order_events');
    expect(rows[0].n).toBe(1);
  });

  it('unwraps the envelope SNS adds when it delivers to SQS', async () => {
    const wrapped = {
      Type: 'Notification',
      Message: JSON.stringify({ ...event, eventId: '6f2d1f0e-3b7a-4c55-8f10-9a2b3c4d5e6f' }),
    };
    await record.execute(JSON.stringify(wrapped));

    const { rows } = await ctx.pool.query('SELECT count(*)::int AS n FROM analytics.order_events');
    expect(rows[0].n).toBe(2);
  });

  it('rejects a message that is not an order event and stores nothing', async () => {
    await expect(record.execute('{"hello":"world"}')).rejects.toThrow();
    await expect(record.execute('not json')).rejects.toThrow();

    const { rows } = await ctx.pool.query('SELECT count(*)::int AS n FROM analytics.order_events');
    expect(rows[0].n).toBe(2);
  });

  it('stores a transfer event whose size is a decimal string with cents', async () => {
    const transfer: OrderEvent = {
      ...event,
      eventId: '9a1c2b3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d',
      order: { ...event.order, instrumentId: 66, side: 'CASH_IN', size: '2777.55', price: '1.00' },
    };
    await record.execute(JSON.stringify(transfer));

    const { rows } = await ctx.pool.query(
      'SELECT payload FROM analytics.order_events WHERE event_id = $1',
      [transfer.eventId],
    );
    expect(rows[0]?.payload.order.size).toBe('2777.55');
  });

  it('rejects a share size sent as a string or a transfer size sent as a number', async () => {
    const shareAsString = { ...event, order: { ...event.order, size: '10.00' } };
    const transferAsNumber = { ...event, order: { ...event.order, side: 'CASH_OUT', size: 10 } };
    await expect(record.execute(JSON.stringify(shareAsString))).rejects.toThrow();
    await expect(record.execute(JSON.stringify(transferAsNumber))).rejects.toThrow();
  });
});
