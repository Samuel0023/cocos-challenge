import type { EventPublisher, OrderEvent } from './order-event.ts';

export class InMemoryEventPublisher implements EventPublisher {
  readonly published: OrderEvent[] = [];

  async publish(event: OrderEvent): Promise<void> {
    this.published.push(event);
  }
}
