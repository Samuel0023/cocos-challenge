import type { Cache } from '../../../platform/cache/cache.ts';
import type { InstrumentRepository, InstrumentSummary } from './instrument-repository.ts';

const CACHE_TTL_SECONDS = 300;

export interface SearchInstrumentsResult {
  items: InstrumentSummary[];
  limit: number;
  offset: number;
  total: number;
}

export class SearchInstruments {
  private readonly repository: InstrumentRepository;
  private readonly cache: Cache;

  constructor(repository: InstrumentRepository, cache: Cache) {
    this.repository = repository;
    this.cache = cache;
  }

  async execute(query: string, limit: number, offset: number): Promise<SearchInstrumentsResult> {
    const text = query.trim().toLowerCase();
    const key = `search:${text}:${limit}:${offset}`;

    const cached = await this.cache.get(key);
    if (cached !== null) return JSON.parse(cached) as SearchInstrumentsResult;

    const { items, total } = await this.repository.search(text, limit, offset);
    const result = { items, limit, offset, total };
    await this.cache.set(key, JSON.stringify(result), CACHE_TTL_SECONDS);
    return result;
  }
}
