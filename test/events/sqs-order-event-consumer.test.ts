import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgOrderEventStore } from '../../src/events/pg-order-event-store.ts';
import { RecordOrderEvent } from '../../src/events/record-order-event.ts';
import {
  SqsOrderEventConsumer,
  type OrderEventQueue,
  type QueueMessage,
} from '../../src/events/sqs-order-event-consumer.ts';
import type { OrderEventMetrics } from '../../src/metrics/metrics.ts';
import type { OrderEvent } from '../../src/shared/events/order-event.ts';
import { silentLogger } from '../../src/shared/logger.ts';
import { createTestApp, type TestApp } from '../support/test-app.ts';

function orderEvent(eventId: string): OrderEvent {
  return {
    eventId,
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
}

/** In-memory queue: `receive` hands out each batch once, then waits like a long poll. */
class FakeQueue implements OrderEventQueue {
  readonly batches: Array<QueueMessage[] | Error> = [];
  readonly deleted: string[] = [];
  receives = 0;

  async receive(signal: AbortSignal): Promise<QueueMessage[]> {
    this.receives++;
    const next = this.batches.shift();
    if (next instanceof Error) throw next;
    if (next) return next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve([]), 20);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(signal.reason);
      });
    });
  }

  async delete(receiptHandle: string): Promise<void> {
    this.deleted.push(receiptHandle);
  }
}

async function until(condition: () => boolean | Promise<boolean>, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('SqsOrderEventConsumer', () => {
  let ctx: TestApp;
  let record: RecordOrderEvent;

  beforeAll(async () => {
    ctx = await createTestApp();
    record = new RecordOrderEvent(new PgOrderEventStore(ctx.pool));
  });

  afterAll(() => ctx.close());

  const consumerFor = (queue: FakeQueue) =>
    new SqsOrderEventConsumer({
      queue,
      recordOrderEvent: record,
      logger: silentLogger,
      errorBackoffMs: 10,
    });

  const storedIds = async () => {
    const { rows } = await ctx.pool.query<{ event_id: string }>(
      'SELECT event_id FROM analytics.order_events',
    );
    return rows.map((row) => row.event_id);
  };

  it('stores a valid message and deletes it from the queue', async () => {
    const queue = new FakeQueue();
    const id = '1d5e6f7a-0000-4000-8000-000000000001';
    queue.batches.push([{ body: JSON.stringify(orderEvent(id)), receiptHandle: 'r-1' }]);
    const consumer = consumerFor(queue);

    consumer.start();
    await until(() => queue.deleted.length === 1);
    await consumer.stop();

    expect(queue.deleted).toEqual(['r-1']);
    expect(await storedIds()).toContain(id);
  });

  it('does not delete a message it could not record, so SQS redelivers it', async () => {
    const queue = new FakeQueue();
    const id = '1d5e6f7a-0000-4000-8000-000000000002';
    queue.batches.push([
      { body: 'not an order event', receiptHandle: 'bad' },
      { body: JSON.stringify(orderEvent(id)), receiptHandle: 'good' },
    ]);
    const consumer = consumerFor(queue);

    consumer.start();
    await until(() => queue.deleted.length === 1);
    await consumer.stop();

    expect(queue.deleted).toEqual(['good']);
    expect(await storedIds()).toContain(id);
  });

  it('keeps polling after a receive error', async () => {
    const queue = new FakeQueue();
    const id = '1d5e6f7a-0000-4000-8000-000000000003';
    queue.batches.push(new Error('network down'), [
      { body: JSON.stringify(orderEvent(id)), receiptHandle: 'r-3' },
    ]);
    const consumer = consumerFor(queue);

    consumer.start();
    await until(() => queue.deleted.length === 1);
    await consumer.stop();

    expect(queue.receives).toBeGreaterThanOrEqual(2);
    expect(await storedIds()).toContain(id);
  });

  it('stop() aborts the in-flight poll and ends the loop', async () => {
    const queue = new FakeQueue();
    const consumer = consumerFor(queue);

    consumer.start();
    await until(() => queue.receives >= 1);
    await consumer.stop();
    const receivesAtStop = queue.receives;
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(queue.receives).toBe(receivesAtStop);
  });

  it('reports processed and failed messages, their latency and the queue backlog', async () => {
    const queue = new FakeQueue();
    const backlogs = [3, 1];
    const backlog = Object.assign(queue, {
      approximateBacklog: async () => backlogs.shift() ?? 0,
    });
    const recorded = {
      processed: 0,
      failed: 0,
      durations: [] as number[],
      backlog: [] as number[],
    };
    const metrics: OrderEventMetrics = {
      orderEventProcessed: (seconds) => {
        recorded.processed++;
        recorded.durations.push(seconds);
      },
      orderEventFailed: (seconds) => {
        recorded.failed++;
        recorded.durations.push(seconds);
      },
      orderEventsBacklog: (messages) => recorded.backlog.push(messages),
    };
    const id = '1d5e6f7a-0000-4000-8000-000000000004';
    queue.batches.push([
      { body: 'not an order event', receiptHandle: 'bad' },
      { body: JSON.stringify(orderEvent(id)), receiptHandle: 'good' },
    ]);
    const consumer = new SqsOrderEventConsumer({
      queue: backlog,
      recordOrderEvent: record,
      logger: silentLogger,
      errorBackoffMs: 10,
      metrics,
    });

    consumer.start();
    await until(() => recorded.processed === 1 && recorded.backlog.length >= 2);
    await consumer.stop();

    expect(recorded.failed).toBe(1);
    expect(recorded.durations).toHaveLength(2);
    expect(recorded.durations.every((seconds) => seconds >= 0)).toBe(true);
    expect(recorded.backlog.slice(0, 2)).toEqual([3, 1]);
  });

  it('keeps consuming when the backlog cannot be read', async () => {
    const queue = Object.assign(new FakeQueue(), {
      approximateBacklog: async (): Promise<number> => {
        throw new Error('attributes unavailable');
      },
    });
    const id = '1d5e6f7a-0000-4000-8000-000000000005';
    queue.batches.push([{ body: JSON.stringify(orderEvent(id)), receiptHandle: 'r-5' }]);
    const consumer = consumerFor(queue);

    consumer.start();
    await until(() => queue.deleted.length === 1);
    await consumer.stop();

    expect(await storedIds()).toContain(id);
  });
});
