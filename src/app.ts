import express, { type Express } from 'express';
import type pg from 'pg';
import { createHealthRouter } from './health/health.router.ts';
import { createInstrumentsRouter } from './instruments/http/router.ts';
import { createMetricsRouter, requestMetrics } from './metrics/http.ts';
import type { AppMetrics } from './metrics/metrics.ts';
import { createOrdersRouter } from './orders/http/router.ts';
import { createPortfolioRouter } from './portfolio/http/router.ts';
import type { EventPublisher } from './shared/events/order-event.ts';
import { errorMiddleware, routeNotFound } from './shared/http/error-middleware.ts';
import type { Logger } from './shared/logger.ts';
import type { Cache } from './shared/ports/cache.ts';
import type { Clock } from './shared/ports/clock.ts';

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
  app.use(createInstrumentsRouter(deps));
  app.use(createPortfolioRouter(deps));
  app.use(createOrdersRouter(deps));

  app.use(routeNotFound);
  app.use(errorMiddleware(deps.logger));
  return app;
}
