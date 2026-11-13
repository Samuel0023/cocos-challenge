import { randomUUID } from 'node:crypto';
import type { EventPublisher, OrderEventType } from '../../shared/events/order-event.ts';
import type { OrderMetrics } from '../../metrics/metrics.ts';
import type { Logger } from '../../shared/logger.ts';
import type { Clock } from '../../shared/ports/clock.ts';
import { sizeToJson, type Order } from '../domain/order.ts';

/** Publishes after commit; a failure is logged and never reaches the caller. */
export async function publishOrderEvent(
  deps: { eventPublisher: EventPublisher; clock: Clock; logger: Logger },
  type: OrderEventType,
  order: Order,
): Promise<void> {
  try {
    await deps.eventPublisher.publish({
      eventId: randomUUID(),
      type,
      occurredAt: deps.clock.now().toISOString(),
      order: {
        id: order.id,
        userId: order.userId,
        instrumentId: order.instrumentId,
        side: order.side,
        type: order.type,
        status: order.status,
        size: sizeToJson(order),
        price: order.price.toString(),
      },
    });
  } catch (err) {
    deps.logger.error({ err, orderId: order.id, type }, 'order event not published');
  }
}

/** Counts a stored order or a cancellation; a failure is logged and never reaches the caller. */
export function countOrder(deps: { metrics: OrderMetrics; logger: Logger }, order: Order): void {
  try {
    deps.metrics.orderRecorded({ status: order.status, side: order.side, type: order.type });
  } catch (err) {
    deps.logger.error({ err, orderId: order.id }, 'order not counted in metrics');
  }
}
