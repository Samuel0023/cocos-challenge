import { Money } from '../../../platform/money.ts';
import type { MarketDataRepository } from '../../marketdata/application/market-data-repository.ts';
import type { PriceSource } from '../application/ports.ts';

/** MARKET price: the latest close from the (cached) market data repository. */
export class MarketPriceSource implements PriceSource {
  private readonly marketData: MarketDataRepository;

  constructor(marketData: MarketDataRepository) {
    this.marketData = marketData;
  }

  async latestClose(instrumentId: number): Promise<Money | null> {
    const quote = (await this.marketData.getLatestQuotes([instrumentId])).get(instrumentId);
    return quote ? Money.parse(quote.close) : null;
  }
}
