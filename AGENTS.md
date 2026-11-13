# AGENTS.md

Context for AI coding agents working in this repository. Read it before changing code.

## What the service does

REST API for a broker (Cocos backend challenge). It returns a user's portfolio, searches instruments and accepts orders and cash transfers. Each stored or cancelled order is published to SNS; a consumer loop in the same process reads SQS and stores the events. `GET /metrics` feeds Prometheus and a provisioned Grafana dashboard. Node.js, Express 5, TypeScript, PostgreSQL, Valkey as cache, AWS Emulator for SNS/SQS locally.

## Architecture in brief

Hexagonal, organised by feature: `src/portfolio`, `src/instruments`, `src/orders`, `src/marketdata`, `src/events`, `src/metrics`, `src/shared`. Use cases in `application/` depend on ports. Adapters in `infra/` (PostgreSQL with `pg`) and `http/` (Express) implement or call them. The domain has no dependencies. `src/app.ts` wires the app from `AppDeps`; `src/main.ts` is the composition root. Details: `docs/architecture.md`.

## Conventions

- Code, comments, tests and docs are in English.
- Node runs the TypeScript directly by type stripping. Do not use TypeScript parameter properties, enums or namespaces. Declare fields explicitly and assign them in the constructor.
- Import with the `.ts` extension: `import { x } from './x.ts'`.
- Money is `Money` (`src/shared/domain/money.ts`): a `bigint` number of cents. The API exchanges decimal strings with two decimals.
- SQL is written with `pg`. There is no ORM.
- Tests: `make test` (Vitest, Supertest, Testcontainers). Run `make lint` and `make typecheck` before finishing.
- Conventional Commits for commit messages.

## Key rules

- Never use floating point for money.
- `POST /orders` and `POST /orders/:orderId/cancel` lock the user row with `SELECT ... FOR UPDATE` at `READ COMMITTED`. Balance checks happen under that lock.
- `REJECTED` is stored only for missing cash or shares. Malformed requests return 4xx and store nothing.
- The cache is best-effort. A `Cache` implementation never throws; on failure read PostgreSQL.
- Events are published after commit. A publish failure is logged and never undoes the order.
- `POST /orders` requires an `Idempotency-Key` UUID header, stored in `orders.clientorderid`.
- The SQS consumer deletes a message only after storing it; it never crashes and `stop()` ends it promptly.
- Use cases and the consumer record metrics through the ports in `src/metrics/metrics.ts`, never `prom-client` directly. Recording a metric never fails a request. `orders_total` counts stored orders and cancellations, never idempotent replays.
- Each app owns its metrics registry, passed in `AppDeps.metrics`. Tests get one from `createTestApp`.
- Balances and positions are computed from `orders`. There is no balances table.

## Where things are

| Need                      | Look at                                                                         |
| ------------------------- | ------------------------------------------------------------------------------- |
| Endpoints and examples    | `docs/api.md`, `requests.http`, `agents/api-contract.md`                        |
| Step-by-step flows        | `docs/flows.md`, `agents/use-cases.md`                                          |
| Tables and schema changes | `db/`, `agents/data-model.md`                                                   |
| Decisions D-01 to D-24    | `docs/decisions.md`, `agents/decisions.md`                                      |
| Local environment         | `docs/local-setup.md`, `Makefile`, `compose.yaml`, `compose.aws.yaml`           |
| Events and AWS Emulator   | `src/events/`, `docker/aws-emulator/`, `docs/local-setup.md`                    |
| Metrics and dashboard     | `src/metrics/`, `docker/prometheus/`, `docker/grafana/`, `docs/architecture.md` |
| Diagrams                  | `docs/diagrams/cocos-solution.drawio`                                           |
| Running the service       | `agents/skills/run-service/SKILL.md`                                            |

## Skills

The single copy of each skill is in `agents/skills/<name>/SKILL.md`, in the open Agent Skills format. To use it in a tool, link the folder from the tool's skills directory. Vendor folders such as `.claude/skills` must be symlinks to the copy in `agents/skills`, never copies.

```sh
mkdir -p .claude/skills
ln -s ../../agents/skills/run-service .claude/skills/run-service
```

Use the same link under the folder your tool reads (for example `.agents/skills` or `.opencode/skills`).
