import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';
import type { AppMetrics, HttpRequestSample, OrderLabels } from './metrics.ts';

export interface PrometheusMetricsOptions {
  /** Node process metrics (event loop lag, heap, GC). On by default. */
  defaultMetrics?: boolean;
}

/**
 * prom-client adapter. Each instance owns its registry, so several apps in one process
 * (tests) do not collide on metric names.
 */
export class PrometheusMetrics implements AppMetrics {
  readonly registry = new Registry();
  private readonly httpDuration: Histogram<'method' | 'route' | 'status_code'>;
  private readonly orders: Counter<'status' | 'side' | 'type'>;
  private readonly eventsProcessed: Counter;
  private readonly eventsFailed: Counter;
  private readonly eventDuration: Histogram;
  private readonly backlog: Gauge;

  constructor(options: PrometheusMetricsOptions = {}) {
    const registers = [this.registry];
    if (options.defaultMetrics ?? true) collectDefaultMetrics({ register: this.registry });

    this.httpDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request latency by method, Express route pattern and status code',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers,
    });
    this.orders = new Counter({
      name: 'orders_total',
      help: 'Orders stored by status, side and type; a cancellation counts as CANCELLED',
      labelNames: ['status', 'side', 'type'],
      registers,
    });
    this.eventsProcessed = new Counter({
      name: 'order_events_processed_total',
      help: 'Order event messages recorded and deleted from the queue',
      registers,
    });
    this.eventsFailed = new Counter({
      name: 'order_events_failed_total',
      help: 'Order event messages that could not be recorded (left in the queue)',
      registers,
    });
    this.eventDuration = new Histogram({
      name: 'order_event_processing_duration_seconds',
      help: 'Time to record and delete one order event message',
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
      registers,
    });
    this.backlog = new Gauge({
      name: 'order_events_queue_backlog',
      help: 'Approximate number of messages waiting in the order events queue',
      registers,
    });
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }

  httpRequest(sample: HttpRequestSample): void {
    this.httpDuration.observe(
      { method: sample.method, route: sample.route, status_code: String(sample.statusCode) },
      sample.durationSeconds,
    );
  }

  orderRecorded(order: OrderLabels): void {
    this.orders.inc({ status: order.status, side: order.side, type: order.type });
  }

  orderEventProcessed(durationSeconds: number): void {
    this.eventsProcessed.inc();
    this.eventDuration.observe(durationSeconds);
  }

  orderEventFailed(durationSeconds: number): void {
    this.eventsFailed.inc();
    this.eventDuration.observe(durationSeconds);
  }

  orderEventsBacklog(messages: number): void {
    this.backlog.set(messages);
  }
}
