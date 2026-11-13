import { PublishCommand } from '@aws-sdk/client-sns';
import type { Logger } from '../logger.ts';
import type { EventPublisher, OrderEvent } from './order-event.ts';

/** The part of SNSClient this publisher uses, so tests can pass a fake. */
export interface SnsPublishClient {
  send(command: PublishCommand): Promise<unknown>;
}

/** Used with AWS_ENABLED=true. Failures are logged, never thrown (the order is already committed). */
export class SnsEventPublisher implements EventPublisher {
  private readonly client: SnsPublishClient;
  private readonly topicArn: string;
  private readonly logger: Logger;

  constructor(client: SnsPublishClient, topicArn: string, logger: Logger) {
    this.client = client;
    this.topicArn = topicArn;
    this.logger = logger;
  }

  async publish(event: OrderEvent): Promise<void> {
    try {
      await this.client.send(
        new PublishCommand({ TopicArn: this.topicArn, Message: JSON.stringify(event) }),
      );
    } catch (error) {
      this.logger.error(
        { err: error, eventId: event.eventId, type: event.type, orderId: event.order.id },
        'order event publish failed',
      );
    }
  }
}
