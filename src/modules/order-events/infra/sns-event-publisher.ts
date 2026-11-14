import { PublishCommand } from '@aws-sdk/client-sns';
import type { Logger } from '../../../platform/logger.ts';
import type { EventPublisher } from '../application/event-publisher.ts';
import type { OrderEvent } from '../domain/order-event.ts';

/** The part of SNSClient this publisher uses, so tests can pass a fake. */
export interface SnsPublishClient {
  send(command: PublishCommand, options?: { abortSignal?: AbortSignal }): Promise<unknown>;
}

export interface SnsEventPublisherOptions {
  /** Longest wait for one publish before it is aborted and logged. */
  timeoutMs?: number;
}

/** The order is already committed: a slow SNS must not hold its response for long. */
export const SNS_PUBLISH_TIMEOUT_MS = 3_000;

/** Used with AWS_ENABLED=true. Failures are logged, never thrown (the order is already committed). */
export class SnsEventPublisher implements EventPublisher {
  private readonly client: SnsPublishClient;
  private readonly topicArn: string;
  private readonly logger: Logger;
  private readonly timeoutMs: number;

  constructor(
    client: SnsPublishClient,
    topicArn: string,
    logger: Logger,
    options: SnsEventPublisherOptions = {},
  ) {
    this.client = client;
    this.topicArn = topicArn;
    this.logger = logger;
    this.timeoutMs = options.timeoutMs ?? SNS_PUBLISH_TIMEOUT_MS;
  }

  async publish(event: OrderEvent): Promise<void> {
    const context = { eventId: event.eventId, type: event.type, orderId: event.order.id };
    const signal = AbortSignal.timeout(this.timeoutMs);
    try {
      const command = new PublishCommand({
        TopicArn: this.topicArn,
        Message: JSON.stringify(event),
      });
      await settleBefore(this.client.send(command, { abortSignal: signal }), signal);
    } catch (error) {
      if (signal.aborted) {
        this.logger.warn(
          { ...context, timeoutMs: this.timeoutMs },
          'order event publish timed out',
        );
        return;
      }
      this.logger.error({ err: error, ...context }, 'order event publish failed');
    }
  }
}

/** Settles with `work`, or rejects when `signal` aborts first, even if `work` ignores the signal. */
function settleBefore<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}
