# Local setup

This document explains how to run the service locally: Docker services, environment variables, the AWS Emulator, metrics and common problems.

## Two ways to run

| Mode        | Commands                        | API runs                     | Events                                         |
| ----------- | ------------------------------- | ---------------------------- | ---------------------------------------------- |
| Development | `make services` then `make dev` | On the host, with Node       | `make dev` sets the AWS variables for the host |
| Full        | `make up`                       | In Docker, with the services | `compose.aws.yaml` sets them for the container |

Stop everything with `make down`. See page "Entorno local" of `docs/diagrams/cocos-solution.drawio`.

Run `make down` before switching modes. `make services` uses only `compose.yaml`, so running it while the `make up` stack is up recreates `aws-emulator` and wipes its in-memory topic and queue.

## Docker services

Defined in `compose.yaml`. `make up` adds `compose.aws.yaml` and the `api` profile.

| Service        | Image                                       | Port             | Notes                                                                                                 |
| -------------- | ------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------- |
| `postgres`     | `postgres:17-alpine`                        | 5432             | Loads `db/database.sql` and the migration on first start. User, password and database are all `cocos` |
| `valkey`       | `valkey/valkey:8-alpine`                    | 6379             | Cache                                                                                                 |
| `aws-emulator` | Built from `docker/aws-emulator/Dockerfile` | 9297 (127.0.0.1) | SNS and SQS. Telemetry off (`-t off`). In `make up` it also publishes the API port 3000               |
| `aws-init`     | `public.ecr.aws/aws-cli/aws-cli:2.27.50`    | none             | Runs `docker/aws-emulator/init.sh`: creates the topic, queues and subscription, then exits            |
| `prometheus`   | `prom/prometheus:v3.5.0`                    | 9090             | Scrapes `host.docker.internal:3000/metrics` every 5 seconds (`prometheus/prometheus.yml`)             |
| `grafana`      | `grafana/grafana:12.1.1`                    | 3001             | Provisioned datasource and dashboard, anonymous `Viewer` access                                       |
| `api`          | Built from `Dockerfile`                     | 3000             | Profile `api`. Only started by `make up`                                                              |

The seed is loaded only when the container starts with an empty data directory. `make down` removes the containers, so the next start loads the seed again.

## Environment variables

Read and validated in `src/config.ts`. `make dev` also loads a `.env` file if one exists. `.env.example` lists the base variables; `make dev` and `compose.aws.yaml` set the AWS ones.

| Variable                 | Default                                       | Meaning                                                                   |
| ------------------------ | --------------------------------------------- | ------------------------------------------------------------------------- |
| `PORT`                   | `3000`                                        | HTTP port                                                                 |
| `DATABASE_URL`           | `postgres://cocos:cocos@127.0.0.1:5432/cocos` | PostgreSQL connection string                                              |
| `VALKEY_URL`             | none                                          | Valkey URL. Without it the API runs with no cache                         |
| `AWS_ENABLED`            | `false`                                       | `true` publishes events to SNS. `false` writes them to the log            |
| `CONSUMER_ENABLED`       | `false`                                       | `true` starts the SQS consumer loop. Ignored, with a warning, without AWS |
| `AWS_ENDPOINT_URL`       | none                                          | Emulator endpoint. Unset on AWS                                           |
| `AWS_REGION`             | `us-east-1`                                   | AWS region                                                                |
| `ORDER_EVENTS_TOPIC_ARN` | none                                          | SNS topic ARN. Required when `AWS_ENABLED=true`                           |
| `ORDER_EVENTS_QUEUE_URL` | none                                          | SQS queue URL. Required when `AWS_ENABLED=true`                           |
| `LOG_LEVEL`              | `info`                                        | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`            |

Credentials always come from environment variables or the AWS SDK default chain. `make dev` unsets `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` and `AWS_PROFILE` (the emulator rejects real keys) and points `AWS_SHARED_CREDENTIALS_FILE`, `AWS_CONFIG_FILE` and `NODE_EXTRA_CA_CERTS` at the files the emulator writes to `.aws-emulator/9297/`. `npm run dev` without Make runs the API with `AWS_ENABLED=false`.

## Events (SNS/SQS) and AWS Emulator

| Resource          | Name                 | Notes                                                                        |
| ----------------- | -------------------- | ---------------------------------------------------------------------------- |
| SNS topic         | `order-events`       | The API publishes `order.created` and `order.cancelled` after commit         |
| SQS queue         | `order-events-queue` | Subscribed to the topic. Visibility timeout 30 seconds                       |
| Dead-letter queue | `order-events-dlq`   | A message that fails 5 receives (for example, not an order event) moves here |

AWS Emulator is the official local emulator AWS published on 11 November 2026. Four traits shape the setup:

- **No published image.** `docker/aws-emulator/Dockerfile` follows the Dockerfile in its documentation and installs the rpm for the build architecture.
- **HTTPS with a self-signed certificate** that covers only `localhost` and `127.0.0.1`. For this reason `make dev` runs the API on the host against `https://127.0.0.1:9297`, and `make up` puts `api` and `aws-init` in the emulator's network namespace with `network_mode: service:aws-emulator`.
- **It generates its own credentials and certificate at startup**, in `.aws-emulator/9297/` (a bind mount). The API reads them when it starts, so after the emulator restarts, restart `make dev` too.
- **State is in memory.** `aws-init` creates the resources on every `make services` and `make up`; the script is safe to run again.

Check the whole path with `make test-aws` after `make services`: it publishes to SNS and waits for the consumer to store the event. `make test` skips that test.

If publishing to SNS or receiving from SQS fails against the emulator, run the API with `AWS_ENABLED=false` (`npm run dev`). Order delivery is not affected.

## Metrics

`GET /metrics` returns Prometheus text. `make services` and `make up` start Prometheus and Grafana.

| Tool       | URL                                         | Notes                                                                   |
| ---------- | ------------------------------------------- | ----------------------------------------------------------------------- |
| Grafana    | http://localhost:3001/d/cocos-api/cocos-api | Dashboard "Cocos API" in folder "Cocos". Anonymous read-only (`Viewer`) |
| Prometheus | http://localhost:9090                       | Job `cocos-api`, target `host.docker.internal:3000`                     |

Prometheus scrapes one target in both modes: in `make dev` the API listens on the host port 3000, and in `make up` the API port is published on the host through `aws-emulator`. `extra_hosts: host.docker.internal:host-gateway` makes the name resolve on Linux. With one target the dashboard never counts the same API twice.

| File                                               | Content                                                 |
| -------------------------------------------------- | ------------------------------------------------------- |
| `prometheus/prometheus.yml`                        | Scrape configuration                                    |
| `grafana/provisioning/datasources/prometheus.yaml` | Prometheus as the default datasource (uid `prometheus`) |
| `grafana/provisioning/dashboards/dashboards.yaml`  | Loads dashboards from `grafana/dashboards/`             |
| `grafana/dashboards/cocos-api.json`                | The dashboard                                           |

## Troubleshooting

| Symptom                                                        | Cause and fix                                                                                                                                                                                                                                        |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `make test` cannot find a container runtime                    | Start Docker (Colima, OrbStack or Docker Desktop). Tests need a running daemon                                                                                                                                                                       |
| Testcontainers fails with Colima or another non-default socket | The Makefile reads the socket of the active context with `docker context inspect` and exports `DOCKER_HOST`. Run tests through `make test`, not `npx vitest`. Check the context with `docker context ls` and switch with `docker context use <name>` |
| Testcontainers cannot mount the Docker socket                  | The Makefile sets `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`. Override both variables in the environment if your setup differs                                                                                                     |
| `make services` times out                                      | Run `docker compose ps` and `docker compose logs postgres`. Port 5432 or 6379 may be taken by another process                                                                                                                                        |
| API starts but `/health` returns 503                           | PostgreSQL is not reachable. Check `DATABASE_URL` and that `postgres` is healthy                                                                                                                                                                     |
| Seed data looks stale                                          | The init scripts run only on an empty data directory. Run `make down` and start again                                                                                                                                                                |
| Order events stop after the emulator restarted                 | The emulator wrote new credentials and a new certificate. Restart `make dev`                                                                                                                                                                         |
| Events fail after `make services` ran during `make up`         | `make services` recreated the emulator and wiped its topic and queue. Run `make down`, then `make up`                                                                                                                                                |
| Grafana panels are empty                                       | Check the target at http://localhost:9090/targets. The API must be running on port 3000                                                                                                                                                              |
| Prices are not refreshed after a database change               | Cached prices live 60 seconds and search results 5 minutes                                                                                                                                                                                           |
