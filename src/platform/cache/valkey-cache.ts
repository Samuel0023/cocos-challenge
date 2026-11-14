import { Redis } from 'iovalkey';
import type { Logger } from '../logger.ts';
import type { Cache } from './cache.ts';

export class ValkeyCache implements Cache {
  private readonly client: Redis;
  private readonly logger: Logger;

  constructor(url: string, logger: Logger) {
    this.logger = logger;
    this.client = new Redis(url, {
      // Fail fast instead of queueing commands while Valkey is down.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      commandTimeout: 200,
    });
    this.client.on('error', (error) => logger.warn({ err: error.message }, 'valkey unavailable'));
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (error) {
      this.logger.debug({ err: error, key }, 'cache read failed');
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    try {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } catch (error) {
      this.logger.debug({ err: error, key }, 'cache write failed');
    }
  }

  async close(): Promise<void> {
    this.client.disconnect();
  }
}
