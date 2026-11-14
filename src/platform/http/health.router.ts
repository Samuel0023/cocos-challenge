import { Router } from 'express';
import type { Queryable } from '../postgres/db.ts';

export function createHealthRouter(db: Queryable): Router {
  const router = Router();

  router.get('/health', async (_req, res) => {
    try {
      await db.query('SELECT 1');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });

  return router;
}
