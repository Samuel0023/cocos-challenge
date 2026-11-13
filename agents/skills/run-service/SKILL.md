---
name: run-service
description: Start, check and test the Cocos broker API locally with Make and Docker. Use when asked to run the service, verify it is healthy, run the tests or diagnose why it does not start.
---

# Run the service

Use this skill to start the API, check it responds, and run the tests. Run commands from the repository root.

## Prerequisites

- Node.js 24 or newer
- A running Docker daemon
- Make
- Dependencies installed: `npm ci`

## Start

| Goal                                | Command                                                              |
| ----------------------------------- | -------------------------------------------------------------------- |
| Start PostgreSQL and Valkey         | `make services`                                                      |
| Run the API on the host (port 3000) | `make dev` (keeps running; use a separate terminal or background it) |
| Run everything in Docker            | `make up`                                                            |
| Stop and remove containers          | `make down`                                                          |

Development path: `make services`, then `make dev`.

## Check it is healthy

```sh
curl -s http://localhost:3000/health
curl -s http://localhost:3000/users/1/portfolio
```

- `/health` returns `{"status":"ok"}` with status 200. A 503 means PostgreSQL is not reachable.
- `/users/1/portfolio` returns `totalAccountValue` `904784.00` on the seed data.

## Test and lint

```sh
make test       # needs a running Docker daemon
make lint
make typecheck
```

## Common failures

| Symptom                         | Fix                                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `make services` times out       | Run `docker compose ps` and `docker compose logs postgres`. Port 5432 or 6379 may be in use                                           |
| `make test` cannot reach Docker | Start Docker. Run tests through `make test`, which exports the socket of the active Docker context (Colima, OrbStack, Docker Desktop) |
| `/health` returns 503           | Check that `postgres` is healthy and that `DATABASE_URL` is right                                                                     |
| `Port already in use`           | Set another port: `PORT=3222 make dev`                                                                                                |
| Seed data looks stale           | Run `make down`, then `make services`                                                                                                 |

More detail: `docs/local-setup.md`.
