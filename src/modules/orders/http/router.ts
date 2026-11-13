import { Router } from 'express';
import type { AppDeps } from '../../../app.ts';
import { CachedMarketDataRepository } from '../../marketdata/infra/cached-market-data-repository.ts';
import { PgMarketDataRepository } from '../../marketdata/infra/pg-market-data-repository.ts';
import { badRequest, notFound } from '../../../platform/http/errors.ts';
import { CancelOrder } from '../application/cancel-order.ts';
import { SubmitOrder } from '../application/submit-order.ts';
import { sizeToJson, type Order } from '../domain/order.ts';
import { MarketPriceSource } from '../infra/market-price-source.ts';
import { PgOrderInstrumentRepository } from '../infra/pg-instrument-repository.ts';
import { PgOrderRepository } from '../infra/pg-order-repository.ts';
import { PgUnitOfWork } from '../infra/pg-unit-of-work.ts';
import { requireIdempotencyKey } from './idempotency-key.ts';
import { submitOrderBody } from './schemas.ts';

const MAX_ID = 2_147_483_647;

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
    prices: new MarketPriceSource(
      new CachedMarketDataRepository(new PgMarketDataRepository(deps.pool), deps.cache),
    ),
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
    const { orderId } = req.params;
    if (!/^\d+$/.test(orderId)) throw badRequest('orderId must be a positive integer');
    const id = Number(orderId);
    if (id > MAX_ID) throw notFound(`Order ${orderId} not found`);
    res.json(toBody(await cancelOrder.execute(id)));
  });

  return router;
}
