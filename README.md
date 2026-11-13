# Cocos Challenge API

REST API for a broker: portfolio, instrument search and order submission. Built with Node.js, Express 5 and TypeScript, hexagonal architecture, on the PostgreSQL schema provided by the challenge.

## Prerequisites

- Node.js 24 or newer (the code runs as TypeScript through type stripping)
- Docker, with a running daemon
- Make

## Quick start

```sh
npm ci
make services   # PostgreSQL and Valkey in Docker
make dev        # API on the host, http://localhost:3000
```

| Command         | What it does                                  |
| --------------- | --------------------------------------------- |
| `make services` | Starts PostgreSQL and Valkey in Docker        |
| `make dev`      | Runs the API on the host with file watching   |
| `make up`       | Starts everything in Docker, API included     |
| `make test`     | Runs unit and functional tests (needs Docker) |
| `make lint`     | Runs ESLint and Prettier                      |
| `make down`     | Stops and removes the containers              |

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

`POST /orders` requires an `Idempotency-Key` header with a UUID. Details are in [docs/api.md](docs/api.md).

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
