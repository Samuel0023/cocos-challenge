import { randomUUID } from 'node:crypto';
import { SNSClient } from '@aws-sdk/client-sns';
import { SQSClient } from '@aws-sdk/client-sqs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgOrderEventStore } from '../../src/modules/order-events/infra/pg-order-event-store.ts';
import { RecordOrderEvent } from '../../src/modules/order-events/application/record-order-event.ts';
import {
  SqsOrderEventConsumer,
  SqsOrderEventQueue,
} from '../../src/modules/order-events/infra/sqs-order-event-consumer.ts';
import { SnsEventPublisher } from '../../src/modules/order-events/infra/sns-event-publisher.ts';
import { silentLogger } from '../../src/platform/logger.ts';
import { createTestApp, type TestApp } from '../support/test-app.ts';

// Runs only with `make test-aws`, against the AWS Emulator started by `make services`.
const enabled = process.env.AWS_EMULATOR_TESTS === 'true';

describe.skipIf(!enabled)('order events through AWS Emulator (SNS -> SQS)', () => {
  let ctx: TestApp;
  let consumer: SqsOrderEventConsumer;
  let publisher: SnsEventPublisher;

  beforeAll(async () => {
    ctx = await createTestApp();
    const aws = { region: process.env.AWS_REGION, endpoint: process.env.AWS_ENDPOINT_URL };
    publisher = new SnsEventPublisher(
      new SNSClient(aws),
      process.env.ORDER_EVENTS_TOPIC_ARN!,
      silentLogger,
    );
    consumer = new SqsOrderEventConsumer({
      queue: new SqsOrderEventQueue(new SQSClient(aws), process.env.ORDER_EVENTS_QUEUE_URL!),
      recordOrderEvent: new RecordOrderEvent(new PgOrderEventStore(ctx.pool)),
      logger: silentLogger,
    });
    consumer.start();
  });

  afterAll(async () => {
    await consumer?.stop();
    await ctx?.close();
  });

  it('a published event reaches analytics.order_events', async () => {
    const eventId = randomUUID();
    await publisher.publish({
      eventId,
      type: 'order.created',
      occurredAt: new Date().toISOString(),
      order: {
        id: 1,
        userId: 1,
        instrumentId: 47,
        side: 'BUY',
        type: 'MARKET',
        status: 'FILLED',
        size: 1,
        price: '925.85',
      },
    });

    const deadline = Date.now() + 15_000;
    let rows: Array<{ event_type: string }> = [];
    while (rows.length === 0 && Date.now() < deadline) {
      ({ rows } = await ctx.pool.query(
        'SELECT event_type FROM analytics.order_events WHERE event_id = $1',
        [eventId],
      ));
      if (rows.length === 0) await new Promise((resolve) => setTimeout(resolve, 200));
    }

    expect(rows).toEqual([{ event_type: 'order.created' }]);
  });
});
