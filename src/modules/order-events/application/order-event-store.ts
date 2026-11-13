import type { OrderEvent } from '../domain/order-event.ts';

export interface OrderEventStore {
  /** Must be idempotent on eventId: SQS delivers at least once (D-18). */
  save(event: OrderEvent): Promise<void>;
}
