import type { Cache } from './cache.ts';

/** Cache for tests. `failing` simulates Valkey being down (reads miss, writes are dropped). */
export class InMemoryCache implements Cache {
  readonly entries = new Map<string, { value: string; ttlSeconds: number }>();
  failing = false;

  async get(key: string): Promise<string | null> {
    if (this.failing) return null;
    return this.entries.get(key)?.value ?? null;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (this.failing) return;
    this.entries.set(key, { value, ttlSeconds });
  }
}
