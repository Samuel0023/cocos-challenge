# Cocos Challenge API

A REST API for a broker. With it you can:

- see a user's portfolio: account value, available cash and positions
- search instruments by ticker or name
- submit buy and sell orders, and cash transfers
- cancel an order that has not been executed yet

Every order that is stored or cancelled is also published as an event.

It is built with Node.js, Express 5 and TypeScript, follows a hexagonal architecture, and uses the PostgreSQL schema the challenge provided.

The database runs locally in Docker, loaded from the challenge's schema and seed file. It does not connect to the hosted database the challenge offers; [docs/decisions.md](docs/decisions.md#local-database-instead-of-the-hosted-one) explains why.

## Run it

You need:

- Node.js 24 or newer
- Docker, with the daemon running
- Make

Then:

```sh
npm ci
make services   # starts PostgreSQL and the other services in Docker
make dev        # starts the API at http://localhost:3000
```

Prefer everything in Docker, API included? Run `make up` instead of the last two commands. Run `make down` before switching from one way to the other.

## Try it

Once the API is running, ask for a portfolio:

```sh
curl http://localhost:3000/users/1/portfolio
```

Search for an instrument:

```sh
curl "http://localhost:3000/instruments?q=ypf"
```

Buy two shares at market price:

```sh
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 5b3f1c1e-9f0a-4c1d-8a55-2f4e6d7c8b90" \
  -d '{ "userId": 1, "instrumentId": 47, "side": "BUY", "type": "MARKET", "size": 2 }'
```

Use a new UUID in `Idempotency-Key` for each new order: sending the same key again returns the first order instead of creating another.

There are two easier ways to explore the rest:

- **Swagger UI** at http://localhost:3000/docs lets you call every endpoint from the browser.
- **`requests.http`** has one request per endpoint and per error case, ready to run with the VS Code REST Client extension.

## Endpoints

| Method and path                      | What it does                                | Status codes                 |
| ------------------------------------ | ------------------------------------------- | ---------------------------- |
| `GET /users/:userId/portfolio`       | Account value, available cash and positions | 200, 400, 404                |
| `GET /instruments?q=&limit=&offset=` | Searches instruments by ticker or name      | 200, 400                     |
| `POST /orders`                       | Submits an order or a cash transfer         | 201, 400, 404, 413, 415, 422 |
| `POST /orders/:orderId/cancel`       | Cancels an order in `NEW`                   | 200, 400, 404, 409           |

Two things to know before you call them:

- `POST /orders` needs an `Idempotency-Key` header with a UUID. Sending the same request again with the same key returns the same order instead of creating a second one.
- There is no authentication, because the challenge does not ask for it.

The full request and response formats are in [docs/api.md](docs/api.md).

## Events

Each stored or cancelled order is published to an SNS topic. A consumer inside the API reads the SQS queue and stores the events in `analytics.order_events`. On your machine, SNS and SQS run on AWS Emulator, so you need no AWS account.

## Tests

```sh
make test
```

The tests start their own PostgreSQL container, so Docker must be running. You do not need `make services` first.

There is also a load test, `make load`. In a local run the API served about 1,000 requests per second with no errors, and 95% of order submissions finished within 71 ms. The details are in [docs/local-setup.md](docs/local-setup.md#load-test).

## Commands

| Command          | What it does                                                                |
| ---------------- | --------------------------------------------------------------------------- |
| `make services`  | Starts PostgreSQL, Valkey, AWS Emulator and the monitoring stack in Docker  |
| `make dev`       | Runs the API on your machine and restarts it when a file changes            |
| `make up`        | Starts everything in Docker, API included                                   |
| `make down`      | Stops and removes the containers                                            |
| `make test`      | Runs the unit and functional tests                                          |
| `make test-aws`  | Runs the SNS to SQS integration test (after `make services`)                |
| `make load`      | Runs the k6 load test against a running API (after `make dev` or `make up`) |
| `make lint`      | Runs ESLint and Prettier                                                    |
| `make typecheck` | Runs the TypeScript compiler without emitting files                         |

The API also exposes `GET /health` and `GET /metrics` for operations. `make services` starts Prometheus (http://localhost:9090) and a Grafana dashboard (http://localhost:3001/d/cocos-api/cocos-api) that read them.

## Learn more

| If you want to know                                | Read                                         |
| -------------------------------------------------- | -------------------------------------------- |
| Why it was built this way, and what it leaves out  | [docs/decisions.md](docs/decisions.md)       |
| How the code is organised                          | [docs/architecture.md](docs/architecture.md) |
| What happens step by step in each flow             | [docs/flows.md](docs/flows.md)               |
| The exact requests, responses and errors           | [docs/api.md](docs/api.md)                   |
| How the local environment works, and how to fix it | [docs/local-setup.md](docs/local-setup.md)   |

The diagrams are in `docs/diagrams/`: [the hexagonal view](docs/diagrams/hexagonal-architecture.png) and one image per flow, all exported from `cocos-solution.drawio`.

Working with a coding agent? [AGENTS.md](AGENTS.md) holds its context, and the skills [run-service](.agents/skills/run-service/SKILL.md), [add-module](.agents/skills/add-module/SKILL.md) and [add-use-case](.agents/skills/add-use-case/SKILL.md) cover the common tasks.
