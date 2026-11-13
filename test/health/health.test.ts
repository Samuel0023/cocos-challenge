import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../support/test-app.ts';

describe('GET /health', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.pool.end().catch(() => undefined);
  });

  it('returns 200 when the database answers', async () => {
    const res = await request(ctx.app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('returns 404 with a JSON error for unknown routes', async () => {
    const res = await request(ctx.app).get('/nope');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  it('returns 503 when the database is unreachable', async () => {
    await ctx.pool.end();

    const res = await request(ctx.app).get('/health');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'unavailable' });
  });
});
