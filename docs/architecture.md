# Architecture

This document describes how the code is organised: layers, folders, ports and adapters, and the services around the API. The diagrams are in `docs/diagrams/cocos-solution.drawio`, pages "Hexagonal architecture" and "AWS architecture".

## Layers

Business rules sit in the centre. Everything external enters through adapters that implement ports.

```mermaid
flowchart LR
  subgraph IN["Input adapters"]
    HTTP["Express routes<br/>Zod validation<br/>idempotency middleware"]
    CONS["SQS consumer loop"]
  end
  subgraph APP["Application"]
    UC["GetPortfolio · SearchInstruments<br/>SubmitOrder · CancelOrder<br/>RecordOrderEvent"]
  end
  subgraph DOM["Domain"]
    D["Order · OrderSizing · FundsPolicy<br/>PositionValuation · Money"]
  end
  subgraph OUT["Output adapters"]
    PG["PostgreSQL repositories"]
    VK["Valkey cache"]
    SNS["SNS publisher"]
    MET["Prometheus metrics"]
  end
  HTTP --> UC
  CONS --> UC
  UC --> D
  UC -- ports --> PG
  UC -- ports --> VK
  UC -- ports --> SNS
  UC -- ports --> MET
```

| Layer           | Content                                                                                                                | Depends on       |
| --------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Input adapters  | Express routers, Zod validation, error and request-metrics middleware, `Idempotency-Key` middleware, SQS consumer loop | Application      |
| Application     | Use cases: `GetPortfolio`, `SearchInstruments`, `SubmitOrder`, `CancelOrder`, `RecordOrderEvent`                       | Domain and ports |
| Domain          | `Order` and its statuses, `OrderSizing`, `FundsPolicy`, `PositionValuation`, `Money`                                   | Nothing          |
| Output ports    | Interfaces such as `OrderRepository`, `UnitOfWork`, `Cache`, `EventPublisher`, `OrderMetrics`                          | Domain           |
| Output adapters | PostgreSQL repositories with `pg`, Valkey cache, SNS, log and in-memory event publishers, `PrometheusMetrics`          | Ports            |

## Folders

Business features live in `src/modules/`, and every module uses the same layers: `domain/`, `application/` (use cases and ports), `infra/` (adapters) and `http/` (router). A module only has the layers it needs. Technical pieces that any module can use live in `src/platform/`, the role `pkg/` plays in a Go project.

```text
src/
  app.ts  main.ts  config.ts
  modules/
    orders/         domain/ application/ infra/ http/
    portfolio/      domain/ application/ infra/ http/
    instruments/    application/ infra/ http/
    marketdata/     application/ (MarketDataRepository port, Quote)  infra/ (PostgreSQL, cached wrapper)
    order-events/   domain/ (OrderEvent)  application/ (EventPublisher, OrderEventStore, RecordOrderEvent)
                    infra/ (SNS, log and in-memory publishers, PostgreSQL store, SQS consumer)
  platform/
    http/           errors, error middleware, GET /health, openapi/ (document and Swagger UI)
    observability/  metrics ports, PrometheusMetrics, request metrics and GET /metrics
    postgres/       database pool and withTransaction
    cache/          Cache port, Valkey, no-op and in-memory adapters
    money.ts  clock.ts  logger.ts
```

| Path                        | Content                                                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/app.ts`                | `buildApp(deps)`: wires routers and middleware. `AppDeps` lists what the app needs                                                         |
| `src/main.ts`               | Composition root: reads config, builds adapters, starts the server                                                                         |
| `src/config.ts`             | Environment variables, validated with Zod                                                                                                  |
| `src/modules/instruments/`  | Search: `application/` (use case, port), `infra/` (PostgreSQL), `http/` (router)                                                           |
| `src/modules/portfolio/`    | Portfolio: `domain/position-valuation.ts`, `application/`, `infra/`, `http/`                                                               |
| `src/modules/orders/`       | Orders: `domain/`, `application/` (`SubmitOrder`, `CancelOrder`, `ports.ts`), `infra/`, `http/`                                            |
| `src/modules/marketdata/`   | Latest quotes: the port, the PostgreSQL repository and the cached wrapper                                                                  |
| `src/modules/order-events/` | Event types, `EventPublisher` and its adapters, `RecordOrderEvent`, `OrderEventStore` and `SqsOrderEventConsumer` (the SQS loop)           |
| `src/platform/`             | `Money`, `Clock`, logger, HTTP errors and middleware, health and OpenAPI routes, metrics, cache, database pool                             |
| `test/`                     | Tests by module (`test/orders/`, `test/order-events/`, ...) and `test/platform/`. `test/support/` has the global setup and `createTestApp` |
| `db/`                       | `database.sql` (from the challenge) and `migrations/`                                                                                      |

Two dependency rules keep the folders honest:

1. `src/platform/` never imports from `src/modules/`. ESLint enforces it (`no-restricted-imports` in `eslint.config.js`).
2. A module uses another module only through its `application/` ports or `domain/` types, never its `infra/` or `http/`. Wiring adapters to ports is composition and happens in `src/app.ts`, `src/main.ts` and each module's `http/router.ts`. Today the orders and portfolio routers build `PgMarketDataRepository` and `CachedMarketDataRepository` that way.

## Ports and adapters

| Port                                                             | Defined in                                                 | Adapters                                                                   |
| ---------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| `OrderRepository`                                                | `modules/orders/application/ports.ts`                      | `PgOrderRepository`                                                        |
| `AccountReader` (orders)                                         | `modules/orders/application/ports.ts`                      | `PgAccountReader` in `modules/orders/infra/`                               |
| `InstrumentRepository` (orders)                                  | `modules/orders/application/ports.ts`                      | `PgOrderInstrumentRepository`                                              |
| `PriceSource`                                                    | `modules/orders/application/ports.ts`                      | `MarketPriceSource` over the cached market data                            |
| `UnitOfWork`, `Transaction`                                      | `modules/orders/application/ports.ts`                      | `PgUnitOfWork` (transaction plus user row lock)                            |
| `AccountReader` (portfolio)                                      | `modules/portfolio/application/account-reader.ts`          | `PgAccountReader` in `modules/portfolio/infra/`                            |
| `InstrumentRepository` (search)                                  | `modules/instruments/application/instrument-repository.ts` | `PgInstrumentRepository`                                                   |
| `MarketDataRepository`                                           | `modules/marketdata/application/market-data-repository.ts` | `PgMarketDataRepository`, `CachedMarketDataRepository`                     |
| `Cache`                                                          | `platform/cache/cache.ts`                                  | `ValkeyCache`, `NoCache`, `InMemoryCache` (tests)                          |
| `Clock`                                                          | `platform/clock.ts`                                        | `systemClock`                                                              |
| `EventPublisher`                                                 | `modules/order-events/application/event-publisher.ts`      | `SnsEventPublisher`, `LogEventPublisher`, `InMemoryEventPublisher` (tests) |
| `OrderEventQueue`                                                | `modules/order-events/infra/sqs-order-event-consumer.ts`   | `SqsOrderEventQueue`, a fake queue in tests                                |
| `AppMetrics`, `OrderMetrics`, `OrderEventMetrics`, `HttpMetrics` | `platform/observability/metrics.ts`                        | `PrometheusMetrics`, `noopMetrics`                                         |
| `OrderEventStore`                                                | `modules/order-events/application/order-event-store.ts`    | `PgOrderEventStore`                                                        |

Rules that shape the code:

- SQL goes through `pg`, with no ORM. See [decisions.md](decisions.md).
- The cache never throws. If Valkey fails, adapters read from PostgreSQL.
- `buildApp` takes its dependencies as arguments, so tests swap the cache, publisher, clock and metrics.
- Use cases and the consumer depend on the metrics ports, never on `prom-client`. Recording a metric never fails a request or stops the consumer.

## External services

| Service    | Use                                               | Resource         |
| ---------- | ------------------------------------------------- | ---------------- |
| PostgreSQL | Challenge data and the `analytics` schema         | Database `cocos` |
| Valkey     | Cache for the latest price and for search results | Port 6379        |
| SNS, SQS   | Order events, on AWS Emulator locally             | Port 9297        |
| Prometheus | Scrapes `GET /metrics` every 5 seconds            | Port 9090        |
| Grafana    | Provisioned dashboard "Cocos API"                 | Port 3001        |

Valkey is optional: without `VALKEY_URL` the API uses `NoCache`.

## Events (SNS/SQS)

| Service | Use                                                 | Resource                   |
| ------- | --------------------------------------------------- | -------------------------- |
| SNS     | Receives one event per stored or cancelled order    | Topic `order-events`       |
| SQS     | Queue subscribed to the topic, read by the consumer | Queue `order-events-queue` |
| SQS     | Dead-letter queue, after 5 failed receives          | Queue `order-events-dlq`   |

```mermaid
flowchart LR
  API["API: SubmitOrder / CancelOrder"] -- "publish after commit" --> T["SNS topic<br/>order-events"]
  T --> Q["SQS queue<br/>order-events-queue"]
  Q -- "long polling" --> C["Consumer loop<br/>(same process)"]
  C -- "INSERT ... ON CONFLICT DO NOTHING" --> AN[("analytics.order_events")]
  Q -. "after 5 failed receives" .-> DLQ["order-events-dlq"]
```

- The API publishes `order.created` (with the final order status) and `order.cancelled` after the transaction commits. A publish failure is logged and does not undo the order.
- With `AWS_ENABLED=true`, `SnsEventPublisher` publishes to the topic. With `AWS_ENABLED=false`, `LogEventPublisher` writes events to the log and the consumer does not start.
- The consumer is an async loop inside the API process. It long-polls the queue, stores each event in `analytics.order_events` with `ON CONFLICT DO NOTHING`, then deletes the message. If the insert fails, the message is not deleted and SQS redelivers it; after 5 receives it moves to the dead-letter queue. `CONSUMER_ENABLED` turns it on. A receive error is logged and retried after 5 seconds; the loop never crashes, and `stop()` aborts the long poll on shutdown.
- It does not use a `worker_thread` because the work is I/O. If metrics show it slows the API, it moves to its own process in the same repository.

## Metrics

`GET /metrics` exposes Prometheus metrics with `prom-client`. `PrometheusMetrics` owns its own registry (not the global one), created in `main.ts` and passed through `AppDeps`.

| Metric                                    | Type      | Labels                           | Recorded by                                                                                             |
| ----------------------------------------- | --------- | -------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `http_request_duration_seconds`           | Histogram | `method`, `route`, `status_code` | Middleware. `route` is the Express pattern, or `unmatched`                                              |
| `orders_total`                            | Counter   | `status`, `side`, `type`         | `SubmitOrder` per stored order, `CancelOrder` as `CANCELLED`. Not on an idempotent replay               |
| `order_events_processed_total`            | Counter   | none                             | Consumer, per message recorded and deleted                                                              |
| `order_events_failed_total`               | Counter   | none                             | Consumer, per message left in the queue                                                                 |
| `order_event_processing_duration_seconds` | Histogram | none                             | Consumer, per message                                                                                   |
| `order_events_queue_backlog`              | Gauge     | none                             | Consumer, from SQS `ApproximateNumberOfMessages` before each poll. A read failure is logged and ignored |
| `nodejs_*`, `process_*`                   | Various   | Various                          | prom-client default metrics, event loop lag included                                                    |

Grafana dashboard `docker/grafana/dashboards/cocos-api.json` shows orders by status, the rejection ratio, request rate and p95 latency per route, event loop lag, events processed and failed, event processing latency and queue backlog.

## Reference AWS deployment

This deployment is a reference. It is not part of the deliverable. See page "AWS architecture" in the diagram file.

```mermaid
flowchart LR
  U["Client"] --> ALB["Application Load Balancer"]
  ALB --> ECS["ECS Fargate<br/>API + consumer loop"]
  SM["Secrets Manager"] -. "injected as env vars<br/>by the task definition" .-> ECS
  ECS --> RDS[("RDS for PostgreSQL")]
  ECS --> EC["ElastiCache for Valkey"]
  ECS --> SNS["SNS order-events"]
  SNS --> SQS["SQS order-events-queue"]
  SQS --> ECS
```

- The API runs on ECS Fargate behind an Application Load Balancer.
- PostgreSQL runs on RDS and Valkey on ElastiCache.
- The database credential lives in Secrets Manager and ECS injects it as an environment variable.
- Analytics data would go to a data warehouse in production.
