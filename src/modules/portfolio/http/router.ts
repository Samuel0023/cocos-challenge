import { Router } from 'express';
import type { AppDeps } from '../../../app.ts';
import { notFound } from '../../../platform/errors.ts';
import { parsePathId } from '../../../platform/http/path-id.ts';
import { GetPortfolio } from '../application/get-portfolio.ts';
import { PgPortfolioReader } from '../infra/pg-portfolio-reader.ts';

export function createPortfolioRouter(deps: AppDeps): Router {
  const getPortfolio = new GetPortfolio(new PgPortfolioReader(deps.pool), deps.marketData);
  const router = Router();

  router.get('/users/:userId/portfolio', async (req, res) => {
    const userId = parsePathId(req.params.userId, 'userId');
    if (userId === null) throw notFound(`User ${req.params.userId} not found`);

    const portfolio = await getPortfolio.execute(userId);
    if (!portfolio) throw notFound(`User ${userId} not found`);
    res.json(portfolio);
  });

  return router;
}
