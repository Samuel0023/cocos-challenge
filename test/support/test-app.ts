import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';
import { buildApp, type AppDeps } from '../../src/app.ts';
import { InMemoryEventPublisher } from '../../src/shared/events/in-memory-event-publisher.ts';
import { InMemoryCache } from '../../src/shared/infra/cache/in-memory-cache.ts';
import { createPool } from '../../src/shared/infra/postgres/db.ts';
import { silentLogger } from '../../src/shared/logger.ts';
import { systemClock } from '../../src/shared/ports/clock.ts';

export interface TestApp {
  app: ReturnType<typeof buildApp>;
  pool: pg.Pool;
  events: InMemoryEventPublisher;
  cache: InMemoryCache;
  close: () => Promise<void>;
}

/**
 * Builds the app against a private copy of the seeded database, so test files
 * can write orders without affecting each other.
 */
export async function createTestApp(overrides: Partial<AppDeps> = {}): Promise<TestApp> {
  const adminUrl = inject('adminDatabaseUrl');
  const name = `test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name} TEMPLATE cocos`);
  await admin.end();

  const pool = createPool(adminUrl.replace(/\/postgres$/, `/${name}`));
  const events = new InMemoryEventPublisher();
  const cache = new InMemoryCache();
  const app = buildApp({
    pool,
    cache,
    eventPublisher: events,
    clock: systemClock,
    logger: silentLogger,
    ...overrides,
  });

  return { app, pool, events, cache, close: () => pool.end() };
}
