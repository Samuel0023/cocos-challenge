# Cocos Challenge API

REST API for a broker: portfolio, instrument search and order submission, with order events on SNS/SQS and Prometheus metrics. Built with Node.js, Express 5 and TypeScript, hexagonal architecture, on the PostgreSQL schema provided by the challenge.

## Prerequisites

- Node.js 24 or newer (the code runs as TypeScript through type stripping)
- Docker, with a running daemon
- Make

## Quick start

```sh
npm ci
make services   # PostgreSQL, Valkey, AWS Emulator, Prometheus and Grafana in Docker
make dev        # API on the host, http://localhost:3000, SNS/SQS on AWS Emulator
```

| Command         | What it does                                                                      |
| --------------- | --------------------------------------------------------------------------------- |
| `make services` | Starts PostgreSQL, Valkey, AWS Emulator (topic and queue), Prometheus and Grafana |
| `make dev`      | Runs the API on the host with file watching, events on AWS Emulator               |
| `make up`       | Starts everything in Docker, API included                                         |
| `make test`     | Runs unit and functional tests (needs Docker)                                     |
| `make test-aws` | Runs the SNS to SQS integration test against AWS Emulator (after `make services`) |
| `make lint`     | Runs ESLint and Prettier                                                          |
| `make down`     | Stops and removes the containers                                                  |

Run `make down` before switching between `make services` and `make up`.

Check it works:

```sh
curl http://localhost:3000/health
curl http://localhost:3000/users/1/portfolio
```

`requests.http` has one request per endpoint and per error case (VS Code REST Client).

## Endpoints

| Method and path                      | What it does                                | Status codes       |
| ------------------------------------ | ------------------------------------------- | ------------------ |
| `GET /users/:userId/portfolio`       | Account value, available cash and positions | 200, 400, 404      |
| `GET /instruments?q=&limit=&offset=` | Searches instruments by ticker or name      | 200, 400           |
| `POST /orders`                       | Submits an order or a cash transfer         | 201, 400, 404, 422 |
| `POST /orders/:orderId/cancel`       | Cancels an order in `NEW`                   | 200, 400, 404, 409 |
| `GET /health`                        | Checks the database connection              | 200, 503           |
| `GET /metrics`                       | Prometheus metrics                          | 200                |

`POST /orders` requires an `Idempotency-Key` header with a UUID. Details are in [docs/api.md](docs/api.md).

## Events and metrics

Each stored or cancelled order is published to the SNS topic `order-events`. A consumer loop inside the API reads the SQS queue `order-events-queue` and stores events in `analytics.order_events`. Locally, SNS and SQS run on AWS Emulator.

| Tool       | URL                                         | Notes                                        |
| ---------- | ------------------------------------------- | -------------------------------------------- |
| Grafana    | http://localhost:3001/d/cocos-api/cocos-api | Dashboard "Cocos API", anonymous read access |
| Prometheus | http://localhost:9090                       | Scrapes the API every 5 seconds              |

## Tests

```sh
make test
```

Functional tests use Testcontainers, so a Docker daemon must be running. The Makefile reads the socket of the active Docker context (Colima, OrbStack or Docker Desktop) and passes it to Testcontainers. If it fails, see [docs/local-setup.md](docs/local-setup.md).

## Documentation

- [docs/architecture.md](docs/architecture.md): layers, ports, adapters, services
- [docs/flows.md](docs/flows.md): step-by-step flows, statuses and errors
- [docs/api.md](docs/api.md): requests and responses
- [docs/local-setup.md](docs/local-setup.md): Docker, environment variables, troubleshooting
- [docs/decisions.md](docs/decisions.md): decisions D-01 to D-24, schema changes, limitations
- `docs/diagrams/cocos-solution.drawio`: diagrams, one page per view
- [AGENTS.md](AGENTS.md): context for AI agents
