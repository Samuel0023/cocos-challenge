import type { Cache } from './cache.ts';

/** Used when VALKEY_URL is not set: every read is a miss. */
export class NoCache implements Cache {
  async get(): Promise<string | null> {
    return null;
  }

  async set(): Promise<void> {}
}
