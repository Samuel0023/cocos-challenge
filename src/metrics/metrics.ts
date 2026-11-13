/**
 * Metrics ports. Use cases, the HTTP layer and the consumer depend on these interfaces,
 * never on prom-client. Implementations must not throw.
 */

export interface OrderLabels {
  status: string;
  side: string;
  type: string;
}

/** Counts stored orders and cancellations, never idempotent replays. */
export interface OrderMetrics {
  orderRecorded(order: OrderLabels): void;
}

export interface OrderEventMetrics {
  orderEventProcessed(durationSeconds: number): void;
  orderEventFailed(durationSeconds: number): void;
  /** Approximate number of messages waiting in the queue. */
  orderEventsBacklog(messages: number): void;
}

export interface HttpRequestSample {
  method: string;
  /** Express route pattern, or `unmatched`. */
  route: string;
  statusCode: number;
  durationSeconds: number;
}

export interface HttpMetrics {
  httpRequest(sample: HttpRequestSample): void;
}

/** Everything the app records, plus the scrape output for `GET /metrics`. */
export interface AppMetrics extends OrderMetrics, OrderEventMetrics, HttpMetrics {
  readonly contentType: string;
  render(): Promise<string>;
}

/** For tests and code paths that do not care about metrics. */
export const noopMetrics: AppMetrics = {
  contentType: 'text/plain; version=0.0.4; charset=utf-8',
  orderRecorded: () => {},
  orderEventProcessed: () => {},
  orderEventFailed: () => {},
  orderEventsBacklog: () => {},
  httpRequest: () => {},
  render: async () => '',
};
