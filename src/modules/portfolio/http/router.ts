import { Router } from 'express';
import type { AppDeps } from '../../../app.ts';
import { CachedMarketDataRepository } from '../../marketdata/infra/cached-market-data-repository.ts';
import { PgMarketDataRepository } from '../../marketdata/infra/pg-market-data-repository.ts';
import { badRequest, notFound } from '../../../platform/http/errors.ts';
import { GetPortfolio } from '../application/get-portfolio.ts';
import { PgAccountReader } from '../infra/pg-account-reader.ts';

const POSITIVE_INTEGER = /^[1-9]\d*$/;
const MAX_INT4 = 2_147_483_647;

export function createPortfolioRouter(deps: AppDeps): Router {
  const getPortfolio = new GetPortfolio(
    new PgAccountReader(deps.pool),
    new CachedMarketDataRepository(new PgMarketDataRepository(deps.pool), deps.cache),
  );
  const router = Router();

  router.get('/users/:userId/portfolio', async (req, res) => {
    const { userId: raw } = req.params;
    if (!POSITIVE_INTEGER.test(raw)) throw badRequest('userId must be a positive integer');
    const userId = Number(raw);
    // Beyond the users.id column range: it cannot exist, and PostgreSQL would reject the parameter.
    if (userId > MAX_INT4) throw notFound(`User ${raw} not found`);

    const portfolio = await getPortfolio.execute(userId);
    if (!portfolio) throw notFound(`User ${userId} not found`);
    res.json(portfolio);
  });

  return router;
}
