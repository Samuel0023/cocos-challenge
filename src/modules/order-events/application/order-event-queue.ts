/** One message as the queue hands it out; `receiptHandle` deletes it. */
export interface QueueMessage {
  body: string;
  receiptHandle: string;
}

/** The queue operations the consumer needs; the loop is tested against a fake. */
export interface OrderEventQueue {
  /** Long poll. Rejects when `signal` aborts. */
  receive(signal: AbortSignal): Promise<QueueMessage[]>;
  delete(receiptHandle: string): Promise<void>;
  /** Approximate number of messages waiting; optional, only feeds the backlog metric. */
  approximateBacklog?(signal: AbortSignal): Promise<number>;
}
