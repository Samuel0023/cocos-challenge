import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgOrderEventStore } from '../../src/modules/order-events/infra/pg-order-event-store.ts';
import { RecordOrderEvent } from '../../src/modules/order-events/application/record-order-event.ts';
import { OrderEventConsumer } from '../../src/modules/order-events/application/order-event-consumer.ts';
import type {
  OrderEventQueue,
  QueueMessage,
} from '../../src/modules/order-events/application/order-event-queue.ts';
import { silentLogger } from '../../src/platform/logger.ts';
import { createTestApp, type TestApp } from '../support/test-app.ts';

const ev = (eventId: string) =>
  JSON.stringify({
    eventId,
    type: 'order.created',
    occurredAt: '2026-11-13T12:00:00.000Z',
    order: {
      id: 1,
      userId: 1,
      instrumentId: 47,
      side: 'BUY',
      type: 'MARKET',
      status: 'FILLED',
      size: 1,
      price: '1.00',
    },
  });

class Q implements OrderEventQueue {
  batches: Array<QueueMessage[] | Error> = [];
  deleted: string[] = [];
  deleteFails = false;
  receives = 0;
  async receive(signal: AbortSignal) {
    this.receives++;
    const n = this.batches.shift();
    if (n instanceof Error) throw n;
    if (n) return n;
    return new Promise<QueueMessage[]>((res, rej) => {
      const t = setTimeout(() => res([]), 20);
      signal.addEventListener('abort', () => {
        clearTimeout(t);
        rej(signal.reason);
      });
    });
  }
  async delete(h: string) {
    if (this.deleteFails) throw new Error('delete failed');
    this.deleted.push(h);
  }
}

const until = async (c: () => boolean, ms = 5000) => {
  const d = Date.now() + ms;
  while (!c()) {
    if (Date.now() > d) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe('order event consumer under failures', () => {
  let ctx: TestApp;
  const unhandled: unknown[] = [];
  const onUnhandled = (e: unknown) => unhandled.push(e);
  beforeAll(async () => {
    ctx = await createTestApp();
    process.on('unhandledRejection', onUnhandled);
  });
  afterAll(async () => {
    process.off('unhandledRejection', onUnhandled);
    await ctx.close();
  });
  const count = async (id: string) =>
    Number(
      (
        await ctx.pool.query('SELECT count(*) FROM analytics.order_events WHERE event_id = $1', [
          id,
        ])
      ).rows[0].count,
    );

  it('redelivered message stored once, both deliveries deleted', async () => {
    const q = new Q();
    const id = randomUUID();
    q.batches.push([{ body: ev(id), receiptHandle: 'a' }], [{ body: ev(id), receiptHandle: 'b' }]);
    const c = new OrderEventConsumer({
      queue: q,
      recordOrderEvent: new RecordOrderEvent(new PgOrderEventStore(ctx.pool)),
      logger: silentLogger,
      errorBackoffMs: 10,
    });
    c.start();
    await until(() => q.deleted.length === 2);
    await c.stop();
    expect(await count(id)).toBe(1);
  });

  it('a DB failure leaves the message undeleted and the loop alive', async () => {
    const q = new Q();
    const id = randomUUID();
    let fail = true;
    const store = new PgOrderEventStore(ctx.pool);
    const flaky = {
      save: async (e: Parameters<typeof store.save>[0]) => {
        if (fail) throw new Error('db down');
        return store.save(e);
      },
    };
    q.batches.push([{ body: ev(id), receiptHandle: 'x' }]);
    const c = new OrderEventConsumer({
      queue: q,
      recordOrderEvent: new RecordOrderEvent(flaky),
      logger: silentLogger,
      errorBackoffMs: 10,
    });
    c.start();
    await until(() => q.receives >= 2);
    expect(q.deleted).toEqual([]);
    fail = false;
    q.batches.push([{ body: ev(id), receiptHandle: 'y' }]);
    await until(() => q.deleted.length === 1);
    await c.stop();
    expect(q.deleted).toEqual(['y']);
    expect(await count(id)).toBe(1);
  });

  it('delete failure does not kill the loop', async () => {
    const q = new Q();
    q.deleteFails = true;
    const id = randomUUID();
    q.batches.push([{ body: ev(id), receiptHandle: 'z' }]);
    const c = new OrderEventConsumer({
      queue: q,
      recordOrderEvent: new RecordOrderEvent(new PgOrderEventStore(ctx.pool)),
      logger: silentLogger,
      errorBackoffMs: 10,
    });
    c.start();
    await until(() => q.receives >= 3);
    await c.stop();
    expect(await count(id)).toBe(1);
  });

  it('stop() is prompt during the error backoff and leaves no unhandled rejection', async () => {
    const q = new Q();
    q.batches.push(new Error('boom'));
    const c = new OrderEventConsumer({
      queue: q,
      recordOrderEvent: new RecordOrderEvent(new PgOrderEventStore(ctx.pool)),
      logger: silentLogger,
      errorBackoffMs: 60_000,
    });
    c.start();
    await until(() => q.receives >= 1);
    await new Promise((r) => setTimeout(r, 20));
    const t = Date.now();
    await c.stop();
    expect(Date.now() - t).toBeLessThan(200);
    // start/stop again works
    c.start();
    await c.stop();
    await new Promise((r) => setTimeout(r, 50));
    expect(unhandled).toEqual([]);
  });
});
