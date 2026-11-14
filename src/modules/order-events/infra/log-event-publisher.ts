import type { Logger } from '../../../platform/logger.ts';
import type { EventPublisher } from '../application/event-publisher.ts';
import type { OrderEvent } from '../domain/order-event.ts';

/** Used with AWS_ENABLED=false: events are written to the log instead of SNS. */
export class LogEventPublisher implements EventPublisher {
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  async publish(event: OrderEvent): Promise<void> {
    this.logger.info({ event }, 'order event');
  }
}
