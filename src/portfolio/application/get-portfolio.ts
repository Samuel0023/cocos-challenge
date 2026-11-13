import type { MarketDataRepository } from '../../marketdata/market-data-repository.ts';
import { valuePortfolio, type PortfolioValuation } from '../domain/position-valuation.ts';
import type { AccountReader } from './account-reader.ts';

export interface Portfolio extends PortfolioValuation {
  userId: number;
}

export class GetPortfolio {
  private readonly accounts: AccountReader;
  private readonly marketData: MarketDataRepository;

  constructor(accounts: AccountReader, marketData: MarketDataRepository) {
    this.accounts = accounts;
    this.marketData = marketData;
  }

  /** Returns null when the user does not exist. */
  async execute(userId: number): Promise<Portfolio | null> {
    if (!(await this.accounts.userExists(userId))) return null;

    const [cash, holdings] = await Promise.all([
      this.accounts.getCash(userId),
      this.accounts.getHoldings(userId),
    ]);
    const held = holdings.filter((holding) => holding.quantity > 0);
    const quotes = await this.marketData.getLatestQuotes(held.map((h) => h.instrumentId));

    return {
      userId,
      ...valuePortfolio({
        cashBalance: cash.balance,
        reservedCash: cash.reserved,
        holdings: held,
        quotes,
      }),
    };
  }
}
