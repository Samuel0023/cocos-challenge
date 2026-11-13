import { Router, type Request, type RequestHandler } from 'express';
import type { AppMetrics, HttpMetrics } from './metrics.ts';

/** The Express route pattern (never the raw URL, which would explode label cardinality). */
function routeOf(req: Request): string {
  const route = req.route as { path?: unknown } | undefined;
  return typeof route?.path === 'string' ? `${req.baseUrl}${route.path}` : 'unmatched';
}

/** Records the latency of every request when the response is sent. */
export function requestMetrics(metrics: HttpMetrics): RequestHandler {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      try {
        metrics.httpRequest({
          method: req.method,
          route: routeOf(req),
          statusCode: res.statusCode,
          durationSeconds: Number(process.hrtime.bigint() - start) / 1e9,
        });
      } catch {
        // Metrics never affect the request.
      }
    });
    next();
  };
}

export function createMetricsRouter(metrics: AppMetrics): Router {
  const router = Router();
  router.get('/metrics', async (_req, res) => {
    res.set('Content-Type', metrics.contentType);
    res.send(await metrics.render());
  });
  return router;
}
