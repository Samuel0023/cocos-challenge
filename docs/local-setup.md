# Local setup

This document explains how to run the service locally: Docker services, environment variables, the AWS Emulator and common problems.

## Two ways to run

| Mode        | Commands                        | API runs                     |
| ----------- | ------------------------------- | ---------------------------- |
| Development | `make services` then `make dev` | On the host, with Node       |
| Full        | `make up`                       | In Docker, with the services |

Stop everything with `make down`. See page "Entorno local" of `docs/diagrams/cocos-solution.drawio`.

## Docker services

Defined in `compose.yaml`.

| Service    | Image                    | Port | Notes                                                                                                 |
| ---------- | ------------------------ | ---- | ----------------------------------------------------------------------------------------------------- |
| `postgres` | `postgres:17-alpine`     | 5432 | Loads `db/database.sql` and the migration on first start. User, password and database are all `cocos` |
| `valkey`   | `valkey/valkey:8-alpine` | 6379 | Cache                                                                                                 |
| `api`      | Built from `Dockerfile`  | 3000 | Profile `api`. Only started by `make up`                                                              |

The seed is loaded only when the container starts with an empty data directory. `make down` removes the containers, so the next start loads the seed again.

## Environment variables

Read and validated in `src/config.ts`. `make dev` also loads a `.env` file if one exists. `.env.example` lists the variables.

| Variable           | Default                                       | Meaning                                                        |
| ------------------ | --------------------------------------------- | -------------------------------------------------------------- |
| `PORT`             | `3000`                                        | HTTP port                                                      |
| `DATABASE_URL`     | `postgres://cocos:cocos@127.0.0.1:5432/cocos` | PostgreSQL connection string                                   |
| `VALKEY_URL`       | none                                          | Valkey URL. Without it the API runs with no cache              |
| `AWS_ENABLED`      | `false`                                       | `true` publishes events to SNS. `false` writes them to the log |
| `CONSUMER_ENABLED` | `false`                                       | `true` starts the SQS consumer loop                            |
| `LOG_LEVEL`        | `info`                                        | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent` |

Credentials always come from environment variables.

## Events (SNS/SQS) and AWS Emulator

> This section is the RFC design. The services, `compose.aws.yaml` and the SNS/SQS code are being built, so details may change.

`make services` also starts AWS Emulator and `aws-init`. `make up` runs everything in Docker with `compose.aws.yaml`.

| Service        | What it does                                                   |
| -------------- | -------------------------------------------------------------- |
| `aws-emulator` | Local AWS emulator, at `https://127.0.0.1:9297`                |
| `aws-init`     | Creates the topic, the queue and the subscription with AWS CLI |

AWS Emulator is the official local emulator AWS published on 11 November 2026. Four traits shape the setup:

- **No published image.** It is built with the Dockerfile in its documentation.
- **HTTPS with a self-signed certificate** that covers only `localhost` and `127.0.0.1`. For this reason `make dev` runs the API on the host, and `make up` puts `api` and `aws-init` on the emulator network with `network_mode: service:aws-emulator`.
- **It generates its own credentials at startup.** The API and `aws-init` read them from a shared volume.
- **State is in memory.** `aws-init` creates the resources on every start.

The emulator is new and AWS does not publish its fidelity per service. If publishing to SNS or receiving from SQS fails against it, run the API with `AWS_ENABLED=false`. Order delivery is not affected.

## Metrics

> Designed in the RFC, not built yet.

`make services` also starts Prometheus and Grafana. Grafana shows a provisioned dashboard and allows anonymous read-only access. Prometheus scrapes `/metrics` from the API.

## Troubleshooting

| Symptom                                                        | Cause and fix                                                                                                                                                                                                                                        |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `make test` cannot find a container runtime                    | Start Docker (Colima, OrbStack or Docker Desktop). Tests need a running daemon                                                                                                                                                                       |
| Testcontainers fails with Colima or another non-default socket | The Makefile reads the socket of the active context with `docker context inspect` and exports `DOCKER_HOST`. Run tests through `make test`, not `npx vitest`. Check the context with `docker context ls` and switch with `docker context use <name>` |
| Testcontainers cannot mount the Docker socket                  | The Makefile sets `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`. Override both variables in the environment if your setup differs                                                                                                     |
| `make services` times out                                      | Run `docker compose ps` and `docker compose logs postgres`. Port 5432 or 6379 may be taken by another process                                                                                                                                        |
| API starts but `/health` returns 503                           | PostgreSQL is not reachable. Check `DATABASE_URL` and that `postgres` is healthy                                                                                                                                                                     |
| Seed data looks stale                                          | The init scripts run only on an empty data directory. Run `make down` and start again                                                                                                                                                                |
| Prices are not refreshed after a database change               | Cached prices live 60 seconds and search results 5 minutes                                                                                                                                                                                           |
