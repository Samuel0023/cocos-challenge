import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrometheusMetrics } from '../../../src/platform/observability/prometheus-metrics.ts';
import { orderHelpers, PAMP } from '../../orders/order-helpers.ts';
import { createTestApp, type TestApp } from '../../support/test-app.ts';

/** Value of one sample line in the Prometheus text output, or undefined when absent. */
function sample(body: string, name: string, labels: Record<string, string>): number | undefined {
  const line = body
    .split('\n')
    .find(
      (row) =>
        row.startsWith(`${name}{`) &&
        Object.entries(labels).every(([key, value]) => row.includes(`${key}="${value}"`)),
    );
  return line === undefined ? undefined : Number(line.slice(line.lastIndexOf(' ') + 1));
}

describe('GET /metrics', () => {
  let ctx: TestApp;
  const { post, newUser } = orderHelpers(() => ctx);
  const scrape = async () => (await request(ctx.app).get('/metrics')).text;
  const ordersTotal = async (labels: Record<string, string>) =>
    sample(await scrape(), 'orders_total', labels) ?? 0;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(() => ctx.close());

  it('returns the Prometheus text format', async () => {
    const res = await request(ctx.app).get('/metrics');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.headers['content-type']).toContain('version=0.0.4');
  });

  it('labels request latency with the route pattern and status code', async () => {
    await request(ctx.app).get('/users/1/portfolio').expect(200);

    const body = await scrape();
    const count = sample(body, 'http_request_duration_seconds_count', {
      method: 'GET',
      route: '/users/:userId/portfolio',
      status_code: '200',
    });
    expect(count).toBe(1);
    expect(body).not.toContain('route="/users/1/portfolio"');
  });

  it('labels an unknown URL as unmatched', async () => {
    await request(ctx.app).get('/does/not/exist').expect(404);

    const count = sample(await scrape(), 'http_request_duration_seconds_count', {
      route: 'unmatched',
      status_code: '404',
    });
    expect(count).toBe(1);
  });

  it('counts a FILLED order, a REJECTED order and a cancellation', async () => {
    const userId = await newUser('1000');
    const filled = { status: 'FILLED', side: 'BUY', type: 'MARKET' };
    const rejected = { status: 'REJECTED', side: 'BUY', type: 'LIMIT' };
    const cancelled = { status: 'CANCELLED', side: 'BUY', type: 'LIMIT' };
    const before = {
      filled: await ordersTotal(filled),
      rejected: await ordersTotal(rejected),
      cancelled: await ordersTotal(cancelled),
    };

    await post({ userId, instrumentId: PAMP, side: 'BUY', type: 'MARKET', size: 1 }).expect(201);
    await post({
      userId,
      instrumentId: PAMP,
      side: 'BUY',
      type: 'LIMIT',
      size: 1000,
      price: '900',
    }).expect(201);
    const open = await post({
      userId,
      instrumentId: PAMP,
      side: 'BUY',
      type: 'LIMIT',
      size: 1,
      price: '1',
    }).expect(201);
    await request(ctx.app).post(`/orders/${open.body.id}/cancel`).expect(200);

    expect(await ordersTotal(filled)).toBe(before.filled + 1);
    expect(await ordersTotal(rejected)).toBe(before.rejected + 1);
    expect(await ordersTotal(cancelled)).toBe(before.cancelled + 1);
  });

  it('does not count an idempotent retry', async () => {
    const userId = await newUser('1000');
    const labels = { status: 'NEW', side: 'BUY', type: 'LIMIT' };
    const key = randomUUID();
    const body = { userId, instrumentId: PAMP, side: 'BUY', type: 'LIMIT', size: 1, price: '1' };

    await post(body, key).expect(201);
    const afterFirst = await ordersTotal(labels);
    await post(body, key).expect(201);

    expect(await ordersTotal(labels)).toBe(afterFirst);
  });

  it('registers the Node default metrics, event loop lag included', async () => {
    const body = await new PrometheusMetrics().render();

    expect(body).toContain('nodejs_eventloop_lag_seconds');
  });
});
