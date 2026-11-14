import type { OrderEvent } from '../domain/order-event.ts';

/** Publishing happens after commit and must not throw: a failure never undoes the order. */
export interface EventPublisher {
  publish(event: OrderEvent): Promise<void>;
}
