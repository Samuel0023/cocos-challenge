import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { createTestApp, type TestApp } from '../support/test-app.ts';

type Json = Record<string, unknown>;

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
/** Documentation routes are served next to the API but are not part of it. */
const DOC_ROUTES = new Set(['GET /docs', 'GET /openapi.yaml']);

const asObject = (value: unknown): Json =>
  typeof value === 'object' && value !== null ? (value as Json) : {};

/** Follows a local `$ref` such as `#/components/schemas/Order`. */
function resolve(doc: Json, node: unknown): Json {
  const object = asObject(node);
  const ref = object.$ref;
  if (typeof ref !== 'string') return object;
  const target = ref
    .replace(/^#\//, '')
    .split('/')
    .reduce<unknown>((current, key) => asObject(current)[key], doc);
  return resolve(doc, target);
}

function operation(doc: Json, path: string, method: string): Json {
  return asObject(asObject(asObject(doc.paths)[path])[method]);
}

function declaredStatuses(doc: Json, path: string, method: string): string[] {
  return Object.keys(asObject(operation(doc, path, method).responses));
}

/** Required field lists the body must satisfy; a `oneOf` gives one list per variant. */
function requiredFieldSets(doc: Json, schemaNode: unknown): string[][] {
  const schema = resolve(doc, schemaNode);
  if (Array.isArray(schema.oneOf)) {
    return schema.oneOf.flatMap((variant) => requiredFieldSets(doc, variant));
  }
  if (Array.isArray(schema.allOf)) {
    return [schema.allOf.flatMap((part) => requiredFieldSets(doc, part).flat())];
  }
  return [Array.isArray(schema.required) ? (schema.required as string[]) : []];
}

/** Checks the status is declared for the operation and the body has the declared required fields. */
function expectDeclared(
  doc: Json,
  path: string,
  method: string,
  res: { status: number; body: unknown },
) {
  expect(declaredStatuses(doc, path, method)).toContain(String(res.status));
  const response = resolve(doc, asObject(operation(doc, path, method).responses)[res.status]);
  const schema = asObject(asObject(asObject(response.content)['application/json']).schema);
  const body = asObject(res.body);
  const sets = requiredFieldSets(doc, schema);
  const matches = sets.some((fields) => fields.every((field) => field in body));
  expect(matches, `${method} ${path} ${res.status} body ${JSON.stringify(res.body)}`).toBe(true);
}

/** `GET /users/{userId}/portfolio` style keys for every route mounted in the app. */
function appRoutes(app: TestApp['app']): string[] {
  interface Layer {
    route?: { path: string; methods: Record<string, boolean> };
    handle?: { stack?: Layer[] };
  }
  const routes: string[] = [];
  const visit = (stack: Layer[]) => {
    for (const layer of stack) {
      if (layer.route) {
        const path = layer.route.path.replace(/:(\w+)/g, '{$1}');
        for (const method of Object.keys(layer.route.methods)) {
          routes.push(`${method.toUpperCase()} ${path}`);
        }
      } else if (layer.handle?.stack) {
        visit(layer.handle.stack);
      }
    }
  };
  visit((app.router as unknown as { stack: Layer[] }).stack);
  return [...new Set(routes)];
}

function documentedRoutes(doc: Json): string[] {
  return Object.entries(asObject(doc.paths)).flatMap(([path, item]) =>
    METHODS.filter((method) => method in asObject(item)).map(
      (method) => `${method.toUpperCase()} ${path}`,
    ),
  );
}

describe('OpenAPI document', () => {
  let ctx: TestApp;
  let doc: Json;

  beforeAll(async () => {
    ctx = await createTestApp();
    const res = await request(ctx.app).get('/openapi.yaml');
    doc = asObject(parse(res.text));
  });

  afterAll(async () => {
    await ctx.close();
  });

  const postOrder = (body: object) =>
    request(ctx.app).post('/orders').set('Idempotency-Key', randomUUID()).send(body);

  it('serves the document as YAML', async () => {
    const res = await request(ctx.app).get('/openapi.yaml');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^(application|text)\/yaml/);
    expect(doc.openapi).toBe('3.1.0');
    expect(asObject(doc.info).title).toBeTypeOf('string');
  });

  it('serves Swagger UI at /docs/', async () => {
    const res = await request(ctx.app).get('/docs/');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.text).toContain('swagger-ui');
  });

  it('redirects /docs to /docs/ so the page assets resolve', async () => {
    const res = await request(ctx.app).get('/docs');

    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('/docs/');
  });

  it('documents every route the app mounts, and nothing else', () => {
    const mounted = appRoutes(ctx.app).filter((route) => !DOC_ROUTES.has(route));

    expect(mounted.length).toBeGreaterThan(0);
    expect(documentedRoutes(doc).sort()).toEqual(mounted.sort());
  });

  it('every documented operation reaches a route of the app', async () => {
    for (const route of documentedRoutes(doc)) {
      const [method = '', path = ''] = route.split(' ');
      const url = path.replace('{userId}', '1').replace('{orderId}', '1');
      const res = await request(ctx.app)[method.toLowerCase() as 'get' | 'post'](url);

      const routeNotFound = res.status === 404 && res.body?.error?.message === 'Route not found';
      expect(routeNotFound, route).toBe(false);
      expect(declaredStatuses(doc, path, method.toLowerCase()), route).toContain(
        String(res.status),
      );
    }
  });

  it('declares the portfolio of user 1 and an unknown user', async () => {
    const path = '/users/{userId}/portfolio';
    expectDeclared(doc, path, 'get', await request(ctx.app).get('/users/1/portfolio'));
    expectDeclared(doc, path, 'get', await request(ctx.app).get('/users/999/portfolio'));
    expectDeclared(doc, path, 'get', await request(ctx.app).get('/users/abc/portfolio'));
  });

  it('declares a search and an invalid search', async () => {
    expectDeclared(doc, '/instruments', 'get', await request(ctx.app).get('/instruments?q=pamp'));
    expectDeclared(doc, '/instruments', 'get', await request(ctx.app).get('/instruments'));
  });

  it('declares FILLED, REJECTED, transfer, 400 and 422 orders', async () => {
    const filled = await postOrder({
      userId: 1,
      instrumentId: 47,
      side: 'BUY',
      type: 'MARKET',
      size: 1,
    });
    expect(filled.body.status).toBe('FILLED');
    expectDeclared(doc, '/orders', 'post', filled);

    const rejected = await postOrder({
      userId: 1,
      instrumentId: 47,
      side: 'BUY',
      type: 'MARKET',
      size: 100000,
    });
    expect(rejected.body.status).toBe('REJECTED');
    expectDeclared(doc, '/orders', 'post', rejected);

    const transfer = await postOrder({ userId: 2, side: 'CASH_IN', amount: '2777.55' });
    expect(transfer.body.size).toBe('2777.55');
    expectDeclared(doc, '/orders', 'post', transfer);

    const missingKey = await request(ctx.app).post('/orders').send({ userId: 1 });
    expect(missingKey.status).toBe(400);
    expectDeclared(doc, '/orders', 'post', missingKey);

    const onArs = await postOrder({
      userId: 1,
      instrumentId: 66,
      side: 'BUY',
      type: 'MARKET',
      size: 1,
    });
    expect(onArs.status).toBe(422);
    expectDeclared(doc, '/orders', 'post', onArs);

    const unknownUser = await postOrder({ userId: 999, side: 'CASH_IN', amount: '10' });
    expect(unknownUser.status).toBe(404);
    expectDeclared(doc, '/orders', 'post', unknownUser);
  });

  it('declares a cancel of an order that is not NEW', async () => {
    const res = await request(ctx.app).post('/orders/1/cancel');

    expect(res.status).toBe(409);
    expectDeclared(doc, '/orders/{orderId}/cancel', 'post', res);
  });
});

describe('documentation routes and metrics', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('are not counted as unmatched routes', async () => {
    await request(ctx.app).get('/docs');
    await request(ctx.app).get('/docs/');
    expect((await request(ctx.app).get('/docs/swagger-ui.css')).status).toBe(200);
    await request(ctx.app).get('/openapi.yaml');

    const metrics = await request(ctx.app).get('/metrics');

    expect(metrics.text).not.toContain('route="unmatched"');
    expect(metrics.text).toContain('route="/docs"');
    expect(metrics.text).toContain('route="/openapi.yaml"');
  });

  it('keep the JSON 404 for unknown routes, under /docs too', async () => {
    for (const url of ['/nope', '/docs/nope']) {
      const res = await request(ctx.app).get(url);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
    }
  });
});
