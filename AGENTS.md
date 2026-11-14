# AGENTS.md

Context for AI coding agents working in this repository. Read it before changing code.

## What the service does

REST API for a broker (Cocos backend challenge). It returns a user's portfolio, searches instruments and accepts orders and cash transfers. Each stored or cancelled order is published to SNS; a consumer loop in the same process reads SQS and stores the events. `GET /metrics` feeds Prometheus and a provisioned Grafana dashboard. Node.js, Express 5, TypeScript, PostgreSQL, Valkey as cache, AWS Emulator for SNS/SQS locally.

## Architecture in brief

Hexagonal, organised by feature. Business features are modules in `src/modules/` (`orders`, `portfolio`, `instruments`, `marketdata`, `order-events`). A module has only the layers it needs, out of `domain/`, `application/`, `infra/` and `http/`: `instruments` has no `domain/`, and `marketdata` and `order-events` have no `http/`. Technical pieces shared by every module are in `src/platform/` (error codes, HTTP middleware, health, OpenAPI, observability, PostgreSQL pool, cache, `Money`, `Clock`, logger). Use cases in `application/` depend on ports. Adapters in `infra/` (PostgreSQL with `pg`) and `http/` (Express) implement or call them. The domain does no I/O: it imports only `Money` from `src/platform/money.ts` and `domain/` types, its own or another module's. `src/app.ts` wires the app from `AppDeps`; `src/main.ts` is the composition root. Details: `docs/architecture.md`.

## Conventions

- Code, comments, tests and docs are in English.
- Node runs the TypeScript directly by type stripping. Do not use TypeScript parameter properties, enums or namespaces. Declare fields explicitly and assign them in the constructor.
- Import with the `.ts` extension: `import { x } from './x.ts'`.
- Money is `Money` (`src/platform/money.ts`): a `bigint` number of cents. The API exchanges decimal strings with two decimals.
- SQL is written with `pg`. There is no ORM.
- Tests: `make test` (Vitest, Supertest, Testcontainers). It starts its own PostgreSQL container and needs only a running Docker daemon, not `make services`. Run `make lint`, `make typecheck` and `make test` before finishing.
- A new business feature goes in a new folder under `src/modules/` with the same layers; its tests go in `test/<module>/`. A new technical piece that any module can use goes in `src/platform/`; its tests go in `test/platform/`.
- `src/platform/` never imports from `src/modules/` (ESLint enforces it). A module uses another module only through its `application/` ports or `domain/` types, never its `infra/` or `http/`. An adapter several modules share (the market data repository) is built once in `src/main.ts` and handed over through `AppDeps`; each module router builds only its own module's adapters.
- Conventional Commits for commit messages.

## Key rules

- Never use floating point for money.
- `POST /orders` and `POST /orders/:orderId/cancel` lock the user row with `SELECT ... FOR UPDATE` at `READ COMMITTED`. Balance checks happen under that lock. The lock is not automatic: `UnitOfWork.run` only opens the transaction, and the use case must call `tx.lockUser(userId)` first.
- Use cases signal failures with the helpers in `src/platform/errors.ts` (`notFound`, `conflict`, `unprocessable`). They never set an HTTP status; `src/platform/http/error-middleware.ts` maps each code to one.
- Never edit `db/database.sql`: it is the schema the challenge provided. Schema changes go in `db/migrations/`.
- There is no authentication, by decision (see "Known limitations" in `docs/decisions.md`). Do not add it, or an ownership check, unless asked.
- `REJECTED` is stored only for missing cash or shares. Malformed requests return 4xx and store nothing.
- The cache is best-effort. A `Cache` implementation never throws; on failure read PostgreSQL.
- Events are published after commit. A publish failure is logged and never undoes the order.
- `POST /orders` requires an `Idempotency-Key` UUID header, stored in `orders.clientorderid`.
- The order events consumer deletes a message only after storing it; it never crashes and `stop()` ends it promptly. SNS publish is bounded at 3 seconds.
- Use cases and the consumer record metrics through the ports in `src/platform/observability/metrics.ts`, never `prom-client` directly. Recording a metric never fails a request. `orders_total` counts stored orders and cancellations, never idempotent replays.
- Each app owns its metrics registry, passed in `AppDeps.metrics`. Tests get one from `createTestApp`.
- Balances and positions are computed from `orders`. There is no balances table.

## Where things are

| Need                                       | Look at                                                                                                   |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Endpoints and examples                     | `docs/api.md`, `requests.http`, `.agents/api-contract.md`                                                 |
| OpenAPI and Swagger UI                     | `src/platform/http/openapi/openapi.yaml`, `src/platform/http/openapi/router.ts`, `/docs`, `/openapi.yaml` |
| Step-by-step flows                         | `docs/flows.md`, `.agents/use-cases.md`                                                                   |
| Tables and schema changes                  | `db/`, `.agents/data-model.md`                                                                            |
| Key decisions and limitations              | `docs/decisions.md`, `.agents/decisions.md`                                                               |
| Local environment                          | `docs/local-setup.md`, `Makefile`, `compose.yaml`, `compose.aws.yaml`                                     |
| Events and AWS Emulator                    | `src/modules/order-events/`, `docker/aws-emulator/`, `docs/local-setup.md`                                |
| Metrics and dashboard                      | `src/platform/observability/`, `docker/prometheus/`, `docker/grafana/`, `docs/architecture.md`            |
| Business modules                           | `src/modules/`, `docs/architecture.md`                                                                    |
| Technical pieces                           | `src/platform/`                                                                                           |
| Diagrams                                   | `docs/diagrams/cocos-solution.drawio`                                                                     |
| Skills (run, add a module, add a use case) | `.agents/skills/`                                                                                         |

## Skills

Skills are in `.agents/skills/<name>/SKILL.md`, in the open Agent Skills format. There is one copy of each.

| Skill          | Use it to                                                    |
| -------------- | ------------------------------------------------------------ |
| `run-service`  | Start the service, check it is healthy and run the tests     |
| `add-module`   | Add a new business module under `src/modules/`               |
| `add-use-case` | Add an endpoint or behaviour to a module that already exists |

If your tool reads skills from another folder, link that folder to `.agents/skills`; never copy the files.
