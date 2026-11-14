# Cocos Challenge API

REST API for a broker: portfolio, instrument search and order submission, with order events on SNS/SQS. Built with Node.js, Express 5 and TypeScript, hexagonal architecture, on the PostgreSQL schema provided by the challenge.

## Prerequisites

- Node.js 24 or newer (the code runs as TypeScript through type stripping)
- Docker, with a running daemon
- Make

## Quick start

```sh
npm ci
make services   # PostgreSQL, Valkey, AWS Emulator and the monitoring stack in Docker
make dev        # API on the host, http://localhost:3000, SNS/SQS on AWS Emulator
```

| Command          | What it does                                                                       |
| ---------------- | ---------------------------------------------------------------------------------- |
| `make services`  | Starts PostgreSQL, Valkey, AWS Emulator (topic and queue) and the monitoring stack |
| `make dev`       | Runs the API on the host with file watching, events on AWS Emulator                |
| `make up`        | Starts everything in Docker, API included                                          |
| `make test`      | Runs unit and functional tests (needs Docker)                                      |
| `make test-aws`  | Runs the SNS to SQS integration test against AWS Emulator (after `make services`)  |
| `make load`      | Runs the k6 load test against a running API (after `make dev` or `make up`)        |
| `make lint`      | Runs ESLint and Prettier                                                           |
| `make typecheck` | Runs the TypeScript compiler without emitting                                      |
| `make down`      | Stops and removes the containers                                                   |

Run `make down` before switching between `make services` and `make up`.

Check it works:

```sh
curl http://localhost:3000/health
curl http://localhost:3000/users/1/portfolio
```

`requests.http` has one request per endpoint and per error case (VS Code REST Client).

After starting the API, the interactive docs (Swagger UI) are at http://localhost:3000/docs and the raw OpenAPI document at http://localhost:3000/openapi.yaml.

## Endpoints

| Method and path                      | What it does                                | Status codes                 |
| ------------------------------------ | ------------------------------------------- | ---------------------------- |
| `GET /users/:userId/portfolio`       | Account value, available cash and positions | 200, 400, 404                |
| `GET /instruments?q=&limit=&offset=` | Searches instruments by ticker or name      | 200, 400                     |
| `POST /orders`                       | Submits an order or a cash transfer         | 201, 400, 404, 413, 415, 422 |
| `POST /orders/:orderId/cancel`       | Cancels an order in `NEW`                   | 200, 400, 404, 409           |

`POST /orders` requires an `Idempotency-Key` header with a UUID. There is no authentication: the challenge does not ask for it. `GET /health` and `GET /metrics` are the operational endpoints.

## Events

Each stored or cancelled order is published to an SNS topic. A consumer inside the API reads the SQS queue and stores the events in `analytics.order_events`. Locally, SNS and SQS run on AWS Emulator.

`make services` also starts Prometheus (http://localhost:9090) and a Grafana dashboard (http://localhost:3001/d/cocos-api/cocos-api).

## Tests

```sh
make test
```

Functional tests run against PostgreSQL in Testcontainers, so Docker must be running.

## Documentation

| Document                                     | Content                                             |
| -------------------------------------------- | --------------------------------------------------- |
| [docs/decisions.md](docs/decisions.md)       | Key decisions, schema changes and known limitations |
| [docs/architecture.md](docs/architecture.md) | Layers, folders and events                          |
| [docs/flows.md](docs/flows.md)               | One diagram per flow, statuses and formulas         |
| [docs/api.md](docs/api.md)                   | Requests, responses and errors                      |
| [docs/local-setup.md](docs/local-setup.md)   | Docker services, variables and troubleshooting      |

Diagrams are also in `docs/diagrams/cocos-solution.drawio`, with one PNG export per page in the same folder: [the hexagonal view](docs/diagrams/hexagonal-architecture.png) and one page per flow. [AGENTS.md](AGENTS.md) holds the context for coding agents, with the skills [run-service](.agents/skills/run-service/SKILL.md), [add-module](.agents/skills/add-module/SKILL.md) and [add-use-case](.agents/skills/add-use-case/SKILL.md).
