import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { LogEventPublisher } from './shared/events/log-event-publisher.ts';
import { NoCache } from './shared/infra/cache/no-cache.ts';
import { ValkeyCache } from './shared/infra/cache/valkey-cache.ts';
import { createPool } from './shared/infra/postgres/db.ts';
import { createLogger } from './shared/logger.ts';
import { systemClock } from './shared/ports/clock.ts';

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const pool = createPool(config.DATABASE_URL);
const valkey = config.VALKEY_URL ? new ValkeyCache(config.VALKEY_URL, logger) : undefined;

const app = buildApp({
  pool,
  cache: valkey ?? new NoCache(),
  eventPublisher: new LogEventPublisher(logger),
  clock: systemClock,
  logger,
});

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, 'api listening');
});

function shutdown() {
  server.close(() => {
    void Promise.allSettled([pool.end(), valkey?.close()]).then(() => process.exit(0));
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
