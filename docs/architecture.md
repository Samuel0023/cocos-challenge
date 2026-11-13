# Architecture

This document describes how the code is organised: layers, folders, ports and adapters, and the services around the API. The diagrams are in `docs/diagrams/cocos-solution.drawio`, pages "Arquitectura hexagonal" and "Arquitectura AWS".

## Layers

Business rules sit in the centre. Everything external enters through adapters that implement ports.

| Layer           | Content                                                                                          | Depends on       |
| --------------- | ------------------------------------------------------------------------------------------------ | ---------------- |
| Input adapters  | Express routers, Zod validation, error middleware, `Idempotency-Key` middleware                  | Application      |
| Application     | Use cases: `GetPortfolio`, `SearchInstruments`, `SubmitOrder`, `CancelOrder`, `RecordOrderEvent` | Domain and ports |
| Domain          | `Order` and its statuses, `OrderSizing`, `FundsPolicy`, `PositionValuation`, `Money`             | Nothing          |
| Output ports    | Interfaces such as `OrderRepository`, `UnitOfWork`, `Cache`, `EventPublisher`                    | Domain           |
| Output adapters | PostgreSQL repositories with `pg`, Valkey cache, log and in-memory event publishers              | Ports            |

## Folders

Code is organised by feature, not by technical layer.

| Folder             | Content                                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `src/app.ts`       | `buildApp(deps)`: wires routers and middleware. `AppDeps` lists what the app needs                                                 |
| `src/main.ts`      | Composition root: reads config, builds adapters, starts the server                                                                 |
| `src/config.ts`    | Environment variables, validated with Zod                                                                                          |
| `src/health/`      | `GET /health`                                                                                                                      |
| `src/instruments/` | Search: `application/` (use case, port), `infra/` (PostgreSQL), `http/` (router)                                                   |
| `src/portfolio/`   | Portfolio: `domain/position-valuation.ts`, `application/`, `infra/`, `http/`                                                       |
| `src/orders/`      | Orders: `domain/`, `application/` (`SubmitOrder`, `CancelOrder`, `ports.ts`), `infra/`, `http/`                                    |
| `src/marketdata/`  | Latest quotes: PostgreSQL repository and the cached wrapper                                                                        |
| `src/events/`      | `RecordOrderEvent` use case and the `OrderEventStore` port with its PostgreSQL adapter                                             |
| `src/shared/`      | `Money`, errors and error middleware, `Cache` and `Clock` ports, cache adapters, database pool, logger, event types and publishers |
| `test/`            | Tests by feature. `test/support/` has the global setup and `createTestApp`                                                         |
| `db/`              | `database.sql` (from the challenge) and `migrations/`                                                                              |

## Ports and adapters

| Port                            | Defined in                                         | Adapters                                               |
| ------------------------------- | -------------------------------------------------- | ------------------------------------------------------ |
| `OrderRepository`               | `orders/application/ports.ts`                      | `PgOrderRepository`                                    |
| `AccountReader` (orders)        | `orders/application/ports.ts`                      | `PgAccountReader` in `orders/infra/`                   |
| `InstrumentRepository` (orders) | `orders/application/ports.ts`                      | `PgOrderInstrumentRepository`                          |
| `PriceSource`                   | `orders/application/ports.ts`                      | `MarketPriceSource` over the cached market data        |
| `UnitOfWork`, `Transaction`     | `orders/application/ports.ts`                      | `PgUnitOfWork` (transaction plus user row lock)        |
| `AccountReader` (portfolio)     | `portfolio/application/account-reader.ts`          | `PgAccountReader` in `portfolio/infra/`                |
| `InstrumentRepository` (search) | `instruments/application/instrument-repository.ts` | `PgInstrumentRepository`                               |
| `MarketDataRepository`          | `marketdata/market-data-repository.ts`             | `PgMarketDataRepository`, `CachedMarketDataRepository` |
| `Cache`                         | `shared/ports/cache.ts`                            | `ValkeyCache`, `NoCache`, `InMemoryCache` (tests)      |
| `Clock`                         | `shared/ports/clock.ts`                            | `systemClock`                                          |
| `EventPublisher`                | `shared/events/order-event.ts`                     | `LogEventPublisher`, `InMemoryEventPublisher` (tests)  |
| `OrderEventStore`               | `events/order-event-store.ts`                      | `PgOrderEventStore`                                    |

Rules that shape the code:

- SQL goes through `pg`, with no ORM. See [decisions.md](decisions.md).
- The cache never throws. If Valkey fails, adapters read from PostgreSQL.
- `buildApp` takes its dependencies as arguments, so tests swap the cache, publisher and clock.

## External services

| Service    | Use                                               | Resource         |
| ---------- | ------------------------------------------------- | ---------------- |
| PostgreSQL | Challenge data and the `analytics` schema         | Database `cocos` |
| Valkey     | Cache for the latest price and for search results | Port 6379        |

Valkey is optional: without `VALKEY_URL` the API uses `NoCache`.

## Events (SNS/SQS)

> This section describes the design from the RFC. The SNS publisher and the SQS consumer loop are being built; the `EventPublisher` port, `LogEventPublisher` and `RecordOrderEvent` already exist.

| Service | Use                                                 | Resource                   |
| ------- | --------------------------------------------------- | -------------------------- |
| SNS     | Receives one event per stored or cancelled order    | Topic `order-events`       |
| SQS     | Queue subscribed to the topic, read by the consumer | Queue `order-events-queue` |

- The API publishes `order.created` (with the final order status) and `order.cancelled` after the transaction commits. A publish failure is logged and does not undo the order.
- With `AWS_ENABLED=false`, events are written to the log and the consumer does not start.
- The consumer is an async loop inside the API process. It long-polls the queue, stores each event in `analytics.order_events` with `ON CONFLICT DO NOTHING`, then deletes the message. If the insert fails, the message is not deleted and SQS redelivers it. `CONSUMER_ENABLED` turns it on.
- It does not use a `worker_thread` because the work is I/O. If metrics show it slows the API, it moves to its own process in the same repository.

## Metrics

> Designed in the RFC, not built yet.

`GET /metrics` exposes Prometheus metrics (`prom-client`). Prometheus scrapes it and a provisioned Grafana dashboard shows orders by status, latency per endpoint, event loop lag, processed and failed messages, per-message processing time and queue backlog.

## Reference AWS deployment

This deployment is a reference. It is not part of the deliverable. See page "Arquitectura AWS" in the diagram file.

- The API runs on ECS Fargate behind an Application Load Balancer.
- PostgreSQL runs on RDS and Valkey on ElastiCache.
- The database credential lives in Secrets Manager and ECS injects it as an environment variable.
- Analytics data would go to a data warehouse in production.
