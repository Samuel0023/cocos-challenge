import {
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import type { OrderEventQueue, QueueMessage } from '../application/order-event-queue.ts';

/** Bound for the short calls (delete, attributes); the long poll keeps its own 20 seconds. */
const SQS_REQUEST_TIMEOUT_MS = 5_000;

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
      { abortSignal: AbortSignal.timeout(SQS_REQUEST_TIMEOUT_MS) },
    );
  }

  async approximateBacklog(signal: AbortSignal): Promise<number> {
    const output = await this.client.send(
      new GetQueueAttributesCommand({
        QueueUrl: this.queueUrl,
        AttributeNames: ['ApproximateNumberOfMessages'],
      }),
      { abortSignal: AbortSignal.any([signal, AbortSignal.timeout(SQS_REQUEST_TIMEOUT_MS)]) },
    );
    return Number(output.Attributes?.ApproximateNumberOfMessages ?? 0);
  }
}
