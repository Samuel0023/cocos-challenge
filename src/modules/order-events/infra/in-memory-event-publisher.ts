import type { EventPublisher } from '../application/event-publisher.ts';
import type { OrderEvent } from '../domain/order-event.ts';

export class InMemoryEventPublisher implements EventPublisher {
  readonly published: OrderEvent[] = [];

  async publish(event: OrderEvent): Promise<void> {
    this.published.push(event);
  }
}
