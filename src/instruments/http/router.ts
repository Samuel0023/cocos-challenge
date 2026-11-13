import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../../app.ts';
import { SearchInstruments } from '../application/search-instruments.ts';
import { PgInstrumentRepository } from '../infra/pg-instrument-repository.ts';

const searchQuery = z.object({
  q: z.string().trim().min(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export function createInstrumentsRouter(deps: AppDeps): Router {
  const router = Router();
  const searchInstruments = new SearchInstruments(
    new PgInstrumentRepository(deps.pool),
    deps.cache,
  );

  router.get('/instruments', async (req, res) => {
    const { q, limit, offset } = searchQuery.parse(req.query);
    res.json(await searchInstruments.execute(q, limit, offset));
  });

  return router;
}
