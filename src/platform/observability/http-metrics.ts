import { Router, type Request, type RequestHandler } from 'express';
import type { AppMetrics, HttpMetrics } from './metrics.ts';

/**
 * The Express route pattern (never the raw URL, which would explode label cardinality).
 * A response sent by middleware mounted on a path (the Swagger UI assets under `/docs`) has no
 * route; its fixed mount path is used instead.
 */
function routeOf(req: Request): string {
  const route = req.route as { path?: unknown } | undefined;
  if (typeof route?.path === 'string') return `${req.baseUrl}${route.path}`;
  return req.baseUrl || 'unmatched';
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
