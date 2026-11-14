import { z } from 'zod';
import type { OrderEvent } from '../domain/order-event.ts';
import type { OrderEventStore } from './order-event-store.ts';

const TRANSFER_SIDES = ['CASH_IN', 'CASH_OUT'];

const eventSchema = z.object({
  eventId: z.uuid(),
  type: z.enum(['order.created', 'order.cancelled']),
  occurredAt: z.iso.datetime(),
  order: z
    .object({
      id: z.number().int(),
      userId: z.number().int(),
      instrumentId: z.number().int(),
      side: z.string(),
      type: z.string(),
      status: z.string(),
      size: z.union([z.number().int(), z.string().regex(/^\d+\.\d{2}$/)]),
      price: z.string(),
    })
    .refine(
      (order) => typeof order.size === (TRANSFER_SIDES.includes(order.side) ? 'string' : 'number'),
      { path: ['size'], message: 'Integer shares for BUY/SELL, a decimal string for transfers' },
    ),
});

// Without raw message delivery, SNS wraps the published message in this envelope.
const snsEnvelope = z.object({ Type: z.literal('Notification'), Message: z.string() });

/** Stores one queue message as an order event. Throws when the message is not one. */
export class RecordOrderEvent {
  private readonly store: OrderEventStore;

  constructor(store: OrderEventStore) {
    this.store = store;
  }

  async execute(messageBody: string): Promise<OrderEvent> {
    let parsed: unknown = JSON.parse(messageBody);
    const envelope = snsEnvelope.safeParse(parsed);
    if (envelope.success) parsed = JSON.parse(envelope.data.Message);

    const event = eventSchema.parse(parsed);
    await this.store.save(event);
    return event;
  }
}
