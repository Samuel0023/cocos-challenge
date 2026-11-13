import type { PublishCommand } from '@aws-sdk/client-sns';
import { describe, expect, it } from 'vitest';
import type { OrderEvent } from '../../src/shared/events/order-event.ts';
import { SnsEventPublisher } from '../../src/shared/events/sns-event-publisher.ts';
import { silentLogger } from '../../src/shared/logger.ts';

const TOPIC = 'arn:aws:sns:us-east-1:000000000000:order-events';

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

describe('SnsEventPublisher', () => {
  it('publishes the event as JSON to the configured topic', async () => {
    const sent: PublishCommand[] = [];
    const client = { send: async (command: PublishCommand) => void sent.push(command) };

    await new SnsEventPublisher(client, TOPIC, silentLogger).publish(event);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.input.TopicArn).toBe(TOPIC);
    expect(JSON.parse(sent[0]?.input.Message ?? '')).toEqual(event);
  });

  it('swallows a client error so the order is never affected', async () => {
    const client = {
      send: async () => {
        throw new Error('connection refused');
      },
    };

    await expect(
      new SnsEventPublisher(client, TOPIC, silentLogger).publish(event),
    ).resolves.toBeUndefined();
  });
});
