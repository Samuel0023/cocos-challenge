import { Router } from 'express';
import type { AppDeps } from '../../../app.ts';
import { notFound } from '../../../platform/errors.ts';
import { parsePathId } from '../../../platform/http/path-id.ts';
import { CancelOrder } from '../application/cancel-order.ts';
import { SubmitOrder } from '../application/submit-order.ts';
import { sizeToJson, type Order } from '../domain/order.ts';
import { MarketPriceSource } from '../infra/market-price-source.ts';
import { PgOrderInstrumentRepository } from '../infra/pg-order-instrument-repository.ts';
import { PgOrderRepository } from '../infra/pg-order-repository.ts';
import { PgUnitOfWork } from '../infra/pg-unit-of-work.ts';
import { requireIdempotencyKey } from './idempotency-key.ts';
import { submitOrderBody } from './schemas.ts';

function toBody(order: Order) {
  return {
    id: order.id,
    userId: order.userId,
    instrumentId: order.instrumentId,
    side: order.side,
    type: order.type,
    status: order.status,
    size: sizeToJson(order),
    price: order.price.toString(),
    datetime: order.datetime.toISOString(),
  };
}

export function createOrdersRouter(deps: AppDeps): Router {
  const router = Router();
  const orders = new PgOrderRepository(deps.pool);
  const unitOfWork = new PgUnitOfWork(deps.pool);
  const common = {
    unitOfWork,
    orders,
    eventPublisher: deps.eventPublisher,
    clock: deps.clock,
    logger: deps.logger,
    metrics: deps.metrics,
  };
  const submitOrder = new SubmitOrder({
    ...common,
    instruments: new PgOrderInstrumentRepository(deps.pool),
    prices: new MarketPriceSource(deps.marketData),
  });
  const cancelOrder = new CancelOrder(common);

  router.post('/orders', requireIdempotencyKey, async (req, res) => {
    const body = submitOrderBody.parse(req.body);
    const order = await submitOrder.execute({
      ...body,
      idempotencyKey: res.locals.idempotencyKey as string,
    });
    res.status(201).json(toBody(order));
  });

  router.post('/orders/:orderId/cancel', async (req, res) => {
    const id = parsePathId(req.params.orderId, 'orderId');
    if (id === null) throw notFound(`Order ${req.params.orderId} not found`);
    res.json(toBody(await cancelOrder.execute(id)));
  });

  return router;
}
