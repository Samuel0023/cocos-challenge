import { noopMetrics, type OrderEventMetrics } from '../../../platform/observability/metrics.ts';
import type { Logger } from '../../../platform/logger.ts';
import type { OrderEventQueue, QueueMessage } from './order-event-queue.ts';
import type { RecordOrderEvent } from './record-order-event.ts';

export interface OrderEventConsumerOptions {
  queue: OrderEventQueue;
  recordOrderEvent: RecordOrderEvent;
  logger: Logger;
  /** Pause after a failed receive, so an unreachable queue is not hammered. */
  errorBackoffMs?: number;
  metrics?: OrderEventMetrics;
}

/**
 * Polls the order events queue through its port and records each message.
 * A message is deleted only after it is stored; otherwise the queue redelivers it
 * (SQS: after the visibility timeout). Delivery is at-least-once, deduplicated by eventId.
 */
export class OrderEventConsumer {
  private readonly queue: OrderEventQueue;
  private readonly recordOrderEvent: RecordOrderEvent;
  private readonly logger: Logger;
  private readonly errorBackoffMs: number;
  private readonly metrics: OrderEventMetrics;
  private controller: AbortController | undefined;
  private loop: Promise<void> | undefined;

  constructor(options: OrderEventConsumerOptions) {
    this.queue = options.queue;
    this.recordOrderEvent = options.recordOrderEvent;
    this.logger = options.logger;
    this.errorBackoffMs = options.errorBackoffMs ?? 5_000;
    this.metrics = options.metrics ?? noopMetrics;
  }

  start(): void {
    if (this.loop) return;
    const controller = new AbortController();
    this.controller = controller;
    this.loop = this.run(controller.signal);
    this.logger.info('order events consumer started');
  }

  /** Aborts the in-flight poll and resolves when the loop has ended. */
  async stop(): Promise<void> {
    this.controller?.abort();
    await this.loop;
    this.controller = undefined;
    this.loop = undefined;
  }

  private async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      await this.refreshBacklog(signal);
      if (signal.aborted) break;
      let messages: QueueMessage[];
      try {
        messages = await this.queue.receive(signal);
      } catch (error) {
        if (signal.aborted) break;
        this.logger.error({ err: error }, 'order events receive failed');
        await sleep(this.errorBackoffMs, signal);
        continue;
      }
      for (const message of messages) await this.handle(message);
    }
    this.logger.info('order events consumer stopped');
  }

  /** Once per poll; a failure is logged and ignored, the gauge keeps its last value. */
  private async refreshBacklog(signal: AbortSignal): Promise<void> {
    if (!this.queue.approximateBacklog) return;
    try {
      this.metrics.orderEventsBacklog(await this.queue.approximateBacklog(signal));
    } catch (error) {
      if (!signal.aborted) this.logger.warn({ err: error }, 'order events backlog not read');
    }
  }

  private async handle(message: QueueMessage): Promise<void> {
    const start = performance.now();
    const elapsed = () => (performance.now() - start) / 1000;
    try {
      const event = await this.recordOrderEvent.execute(message.body);
      await this.queue.delete(message.receiptHandle);
      this.record(() => this.metrics.orderEventProcessed(elapsed()));
      this.logger.debug({ eventId: event.eventId, type: event.type }, 'order event recorded');
    } catch (error) {
      // Not deleted: the queue delivers it again (SQS: after the visibility timeout).
      this.record(() => this.metrics.orderEventFailed(elapsed()));
      this.logger.error({ err: error }, 'order event not recorded');
    }
  }

  /** Metrics never break the loop. */
  private record(update: () => void): void {
    try {
      update();
    } catch (error) {
      this.logger.warn({ err: error }, 'order event metric not recorded');
    }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
  });
}
