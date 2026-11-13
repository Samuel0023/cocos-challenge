import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.ts';

describe('loadConfig', () => {
  it('works with an empty environment: AWS and the consumer are off', () => {
    const config = loadConfig({});

    expect(config).toMatchObject({
      PORT: 3000,
      AWS_ENABLED: false,
      CONSUMER_ENABLED: false,
      AWS_REGION: 'us-east-1',
    });
    expect(config.AWS_ENDPOINT_URL).toBeUndefined();
  });

  it('fails with a clear message when AWS_ENABLED=true has no topic or queue', () => {
    expect(() => loadConfig({ AWS_ENABLED: 'true' })).toThrow(
      /ORDER_EVENTS_TOPIC_ARN is required when AWS_ENABLED=true/,
    );
    expect(() => loadConfig({ AWS_ENABLED: 'true' })).toThrow(
      /ORDER_EVENTS_QUEUE_URL is required when AWS_ENABLED=true/,
    );
  });

  it('accepts AWS settings when they are complete', () => {
    const config = loadConfig({
      AWS_ENABLED: 'true',
      CONSUMER_ENABLED: 'true',
      AWS_ENDPOINT_URL: 'https://127.0.0.1:9297',
      AWS_REGION: 'sa-east-1',
      ORDER_EVENTS_TOPIC_ARN: 'arn:aws:sns:sa-east-1:000000000000:order-events',
      ORDER_EVENTS_QUEUE_URL: 'https://sqs.sa-east-1.amazonaws.com/000000000000/order-events-queue',
    });

    expect(config).toMatchObject({
      AWS_ENABLED: true,
      CONSUMER_ENABLED: true,
      AWS_ENDPOINT_URL: 'https://127.0.0.1:9297',
      AWS_REGION: 'sa-east-1',
    });
  });
});
