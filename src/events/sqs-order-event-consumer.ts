import { DeleteMessageCommand, ReceiveMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import type { Logger } from '../shared/logger.ts';
import type { RecordOrderEvent } from './record-order-event.ts';

export interface QueueMessage {
  body: string;
  receiptHandle: string;
}

/** The two queue operations the consumer needs; the loop is tested against a fake. */
export interface OrderEventQueue {
  /** Long poll. Rejects when `signal` aborts. */
  receive(signal: AbortSignal): Promise<QueueMessage[]>;
  delete(receiptHandle: string): Promise<void>;
}

export class SqsOrderEventQueue implements OrderEventQueue {
  private readonly client: SQSClient;
  private readonly queueUrl: string;

  constructor(client: SQSClient, queueUrl: string) {
    this.client = client;
    this.queueUrl = queueUrl;
  }

  async receive(signal: AbortSignal): Promise<QueueMessage[]> {
    const output = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        WaitTimeSeconds: 20,
        MaxNumberOfMessages: 10,
      }),
      { abortSignal: signal },
    );
    return (output.Messages ?? []).flatMap((message) =>
      message.Body !== undefined && message.ReceiptHandle !== undefined
        ? [{ body: message.Body, receiptHandle: message.ReceiptHandle }]
        : [],
    );
  }

  async delete(receiptHandle: string): Promise<void> {
    await this.client.send(
      new DeleteMessageCommand({ QueueUrl: this.queueUrl, ReceiptHandle: receiptHandle }),
    );
  }
}

export interface SqsOrderEventConsumerOptions {
  queue: OrderEventQueue;
  recordOrderEvent: RecordOrderEvent;
  logger: Logger;
  /** Pause after a failed receive, so an unreachable queue is not hammered. */
  errorBackoffMs?: number;
}

/**
 * Input adapter: polls the order events queue and records each message.
 * A message is deleted only after it is stored; otherwise SQS redelivers it
 * after the visibility timeout (at-least-once, deduplicated by eventId).
 */
export class SqsOrderEventConsumer {
  private readonly queue: OrderEventQueue;
  private readonly recordOrderEvent: RecordOrderEvent;
  private readonly logger: Logger;
  private readonly errorBackoffMs: number;
  private controller: AbortController | undefined;
  private loop: Promise<void> | undefined;

  constructor(options: SqsOrderEventConsumerOptions) {
    this.queue = options.queue;
    this.recordOrderEvent = options.recordOrderEvent;
    this.logger = options.logger;
    this.errorBackoffMs = options.errorBackoffMs ?? 5_000;
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

  private async handle(message: QueueMessage): Promise<void> {
    try {
      const event = await this.recordOrderEvent.execute(message.body);
      await this.queue.delete(message.receiptHandle);
      this.logger.debug({ eventId: event.eventId, type: event.type }, 'order event recorded');
    } catch (error) {
      // Not deleted: SQS makes it visible again after the visibility timeout.
      this.logger.error({ err: error }, 'order event not recorded');
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
