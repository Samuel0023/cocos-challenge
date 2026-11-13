import express, { type Express } from 'express';
import type pg from 'pg';
import { createDocsRouter } from './platform/http/openapi/router.ts';
import { createHealthRouter } from './platform/http/health.router.ts';
import { createInstrumentsRouter } from './modules/instruments/http/router.ts';
import { createMetricsRouter, requestMetrics } from './platform/observability/http-metrics.ts';
import type { AppMetrics } from './platform/observability/metrics.ts';
import { createOrdersRouter } from './modules/orders/http/router.ts';
import { createPortfolioRouter } from './modules/portfolio/http/router.ts';
import type { EventPublisher } from './modules/order-events/application/event-publisher.ts';
import { errorMiddleware, routeNotFound } from './platform/http/error-middleware.ts';
import type { Logger } from './platform/logger.ts';
import type { Cache } from './platform/cache/cache.ts';
import type { Clock } from './platform/clock.ts';

/** Everything the app needs from the outside. Tests swap these for in-memory versions. */
export interface AppDeps {
  pool: pg.Pool;
  cache: Cache;
  eventPublisher: EventPublisher;
  clock: Clock;
  logger: Logger;
  /** Owns its own registry; `GET /metrics` renders it. */
  metrics: AppMetrics;
}

export function buildApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestMetrics(deps.metrics));
  app.use(express.json());

  app.use(createHealthRouter(deps.pool));
  app.use(createMetricsRouter(deps.metrics));
  app.use(createDocsRouter());
  app.use(createInstrumentsRouter(deps));
  app.use(createPortfolioRouter(deps));
  app.use(createOrdersRouter(deps));

  app.use(routeNotFound);
  app.use(errorMiddleware(deps.logger));
  return app;
}
