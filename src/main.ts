import { SNSClient } from '@aws-sdk/client-sns';
import { SQSClient } from '@aws-sdk/client-sqs';
import { z } from 'zod';
import { buildApp } from './app.ts';
import { loadConfig, type Config } from './config.ts';
import { PgOrderEventStore } from './events/pg-order-event-store.ts';
import { RecordOrderEvent } from './events/record-order-event.ts';
import { SqsOrderEventConsumer, SqsOrderEventQueue } from './events/sqs-order-event-consumer.ts';
import { LogEventPublisher } from './shared/events/log-event-publisher.ts';
import type { EventPublisher } from './shared/events/order-event.ts';
import { SnsEventPublisher } from './shared/events/sns-event-publisher.ts';
import { NoCache } from './shared/infra/cache/no-cache.ts';
import { ValkeyCache } from './shared/infra/cache/valkey-cache.ts';
import { createPool } from './shared/infra/postgres/db.ts';
import { createLogger } from './shared/logger.ts';
import { systemClock } from './shared/ports/clock.ts';

function readConfig(): Config {
  try {
    return loadConfig();
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw error;
    console.error(`Invalid configuration:\n${z.prettifyError(error)}`);
    process.exit(1);
  }
}

const config = readConfig();
const logger = createLogger(config.LOG_LEVEL);
const pool = createPool(config.DATABASE_URL);
const valkey = config.VALKEY_URL ? new ValkeyCache(config.VALKEY_URL, logger) : undefined;

// Credentials come from the SDK's default chain (environment or shared files).
const awsClientConfig = { region: config.AWS_REGION, endpoint: config.AWS_ENDPOINT_URL };

let eventPublisher: EventPublisher = new LogEventPublisher(logger);
let consumer: SqsOrderEventConsumer | undefined;

if (config.AWS_ENABLED) {
  // loadConfig guarantees both values when AWS_ENABLED=true.
  const topicArn = config.ORDER_EVENTS_TOPIC_ARN!;
  const queueUrl = config.ORDER_EVENTS_QUEUE_URL!;
  eventPublisher = new SnsEventPublisher(new SNSClient(awsClientConfig), topicArn, logger);
  if (config.CONSUMER_ENABLED) {
    consumer = new SqsOrderEventConsumer({
      queue: new SqsOrderEventQueue(new SQSClient(awsClientConfig), queueUrl),
      recordOrderEvent: new RecordOrderEvent(new PgOrderEventStore(pool)),
      logger,
    });
  }
} else if (config.CONSUMER_ENABLED) {
  logger.warn('CONSUMER_ENABLED=true is ignored because AWS_ENABLED=false');
}

const app = buildApp({
  pool,
  cache: valkey ?? new NoCache(),
  eventPublisher,
  clock: systemClock,
  logger,
});

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, aws: config.AWS_ENABLED }, 'api listening');
  consumer?.start();
});

function shutdown() {
  server.close(() => {
    void Promise.allSettled([consumer?.stop()])
      .then(() => Promise.allSettled([pool.end(), valkey?.close()]))
      .then(() => process.exit(0));
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
