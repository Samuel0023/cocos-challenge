import type { EventPublisher } from '../../shared/events/order-event.ts';
import { conflict, notFound } from '../../shared/http/errors.ts';
import type { Logger } from '../../shared/logger.ts';
import type { Clock } from '../../shared/ports/clock.ts';
import type { Order } from '../domain/order.ts';
import { publishOrderEvent } from './order-events.ts';
import type { OrderRepository, UnitOfWork } from './ports.ts';

export interface CancelOrderDeps {
  orders: OrderRepository;
  unitOfWork: UnitOfWork;
  eventPublisher: EventPublisher;
  clock: Clock;
  logger: Logger;
}

export class CancelOrder {
  private readonly deps: CancelOrderDeps;

  constructor(deps: CancelOrderDeps) {
    this.deps = deps;
  }

  async execute(orderId: number): Promise<Order> {
    // First read only finds the owner; the decision uses the re-read under the user lock.
    const found = await this.deps.orders.findById(orderId);
    if (!found) throw notFound(`Order ${orderId} not found`);

    const cancelled = await this.deps.unitOfWork.run(async (tx) => {
      await tx.lockUser(found.userId);
      const current = await tx.orders.findById(orderId);
      if (!current) throw notFound(`Order ${orderId} not found`);
      if (current.status !== 'NEW') {
        throw conflict(`Order ${orderId} is ${current.status} and cannot be cancelled`);
      }
      return tx.orders.updateStatus(orderId, 'CANCELLED');
    });

    await publishOrderEvent(this.deps, 'order.cancelled', cancelled);
    return cancelled;
  }
}
