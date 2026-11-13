import type { Cache } from '../../../platform/cache/cache.ts';
import type { MarketDataRepository, Quote } from '../application/market-data-repository.ts';

/** Nothing loads market data in this challenge, so the TTL is the only expiry rule (D-19). */
export const QUOTE_TTL_SECONDS = 60;

const key = (instrumentId: number) => `quote:${instrumentId}`;

/** Reads quotes from the cache and falls back to the wrapped repository for the misses. */
export class CachedMarketDataRepository implements MarketDataRepository {
  private readonly source: MarketDataRepository;
  private readonly cache: Cache;

  constructor(source: MarketDataRepository, cache: Cache) {
    this.source = source;
    this.cache = cache;
  }

  async getLatestQuotes(instrumentIds: number[]): Promise<Map<number, Quote>> {
    const quotes = new Map<number, Quote>();
    const misses: number[] = [];

    await Promise.all(
      instrumentIds.map(async (id) => {
        const cached = await this.cache.get(key(id));
        if (cached) quotes.set(id, JSON.parse(cached) as Quote);
        else misses.push(id);
      }),
    );

    const fresh = await this.source.getLatestQuotes(misses);
    await Promise.all(
      [...fresh].map(([id, quote]) => {
        quotes.set(id, quote);
        return this.cache.set(key(id), JSON.stringify(quote), QUOTE_TTL_SECONDS);
      }),
    );
    return quotes;
  }
}
