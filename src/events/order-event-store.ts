import type { OrderEvent } from '../shared/events/order-event.ts';

export interface OrderEventStore {
  /** Must be idempotent on eventId: SQS delivers at least once (D-18). */
  save(event: OrderEvent): Promise<void>;
}
