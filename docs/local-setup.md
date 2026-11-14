# Local setup

How to run the service, what each container does and what to check when something fails.

## Two ways to run

| Mode        | Commands                        | The API runs           |
| ----------- | ------------------------------- | ---------------------- |
| Development | `make services` then `make dev` | On the host, with Node |
| Full        | `make up`                       | In Docker              |

```mermaid
flowchart LR
  subgraph HOST["Host"]
    API["API :3000<br/>(make dev)"]
  end
  subgraph DOCKER["Docker (make services)"]
    PG[("postgres :5432")]
    VK["valkey :6379"]
    EM["aws-emulator :9297<br/>SNS + SQS"]
    PR["prometheus :9090"]
    GR["grafana :3001"]
  end
  API --> PG
  API --> VK
  API --> EM
  PR -- "scrape /metrics" --> API
  GR --> PR
```

`make up` runs the same services plus the API in a container. Run `make down` before switching modes: starting one over the other recreates the emulator and wipes its topic and queue.

## Services

| Service        | Port | Notes                                                                               |
| -------------- | ---- | ----------------------------------------------------------------------------------- |
| `postgres`     | 5432 | Loads the challenge seed and the migration. User, password and database are `cocos` |
| `valkey`       | 6379 | Cache. Optional: without `VALKEY_URL` the API runs with no cache                    |
| `aws-emulator` | 9297 | SNS and SQS                                                                         |
| `aws-init`     | none | Creates the topic, the queue and the dead-letter queue, then exits                  |
| `prometheus`   | 9090 | Scrapes the API every 5 seconds                                                     |
| `grafana`      | 3001 | Dashboard and Explore, no login needed                                              |

The database has no volume: `make down` and a new start restore the seed.

## Environment variables

Validated in `src/config.ts`. `make dev` sets the AWS ones; a `.env` file is optional.

| Variable                 | Default                                       | Meaning                                           |
| ------------------------ | --------------------------------------------- | ------------------------------------------------- |
| `PORT`                   | `3000`                                        | HTTP port                                         |
| `DATABASE_URL`           | `postgres://cocos:cocos@127.0.0.1:5432/cocos` | PostgreSQL connection string                      |
| `VALKEY_URL`             | none                                          | Valkey URL                                        |
| `AWS_ENABLED`            | `false`                                       | `true` publishes events to SNS, `false` logs them |
| `CONSUMER_ENABLED`       | `false`                                       | `true` starts the SQS consumer                    |
| `AWS_ENDPOINT_URL`       | none                                          | Emulator endpoint. Unset on AWS                   |
| `AWS_REGION`             | `us-east-1`                                   | AWS region                                        |
| `ORDER_EVENTS_TOPIC_ARN` | none                                          | Required when `AWS_ENABLED=true`                  |
| `ORDER_EVENTS_QUEUE_URL` | none                                          | Required when `AWS_ENABLED=true`                  |
| `LOG_LEVEL`              | `info`                                        | pino level                                        |

`npm run dev` without Make runs the API with events written to the log.

## AWS Emulator

SNS and SQS run on AWS Emulator, built from `docker/aws-emulator/Dockerfile`. Two things about it shape the setup:

- **It serves HTTPS with a certificate valid only for `localhost`.** That is why the API runs on the host in development, and shares the emulator's network in `make up`.
- **It creates new credentials on every start and keeps its state in memory.** `aws-init` recreates the resources each time. If the emulator restarts, restart `make dev` too.

`make test-aws` checks the whole path: it publishes to SNS and waits for the consumer to store the event.

## Load test

`make load` runs [`test/load/api.js`](../test/load/api.js) with k6 in a container, against an API started with `make dev` or `make up`. It holds 20 virtual users for 30 seconds: 40% portfolio, 30% search and 30% a market buy followed by a sell.

| Threshold                   | Limit        |
| --------------------------- | ------------ |
| Failed requests             | below 1%     |
| p95 of portfolio and search | below 300 ms |
| p95 of order submission     | below 500 ms |

Change the load with `make load VUS=50 DURATION=2m`. The test writes thousands of orders; `make down` and `make services` restore the seed.

### What a run looks like

One local run on 13 November 2026. It shows what to expect, not a benchmark.

| Measure               | Value                                                         |
| --------------------- | ------------------------------------------------------------- |
| Peak request rate     | About 1,000 requests per second, no errors                    |
| p95 latency per route | `POST /orders` 70.6 ms, portfolio 29.1 ms, search 9.58 ms     |
| Order events          | All processed. The backlog peaked near 1,000 and drained to 0 |

![Grafana summary and orders panels during the load test](images/load-test-summary-orders.png)

![Grafana HTTP panels during the load test](images/load-test-http.png)

![Grafana order events and runtime panels during the load test](images/load-test-events-runtime.png)

## Metrics

| Tool       | URL                                         |
| ---------- | ------------------------------------------- |
| Grafana    | http://localhost:3001/d/cocos-api/cocos-api |
| Explore    | http://localhost:3001/explore               |
| Prometheus | http://localhost:9090                       |

The dashboard, the datasource and the scrape configuration are under `docker/grafana/` and `docker/prometheus/`.

## Git hooks

`npm ci` installs them with Husky: `pre-commit` runs ESLint and Prettier on the staged files, and `commit-msg` checks Conventional Commits.

## Troubleshooting

| Symptom                                                | Fix                                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `make test` cannot find a container runtime            | Start Docker. Run tests with `make test`, which passes the active Docker socket to Testcontainers |
| `make services` times out                              | Port 5432 or 6379 is taken. Check `docker compose ps`                                             |
| `/health` returns 503                                  | PostgreSQL is not reachable. Check `DATABASE_URL`                                                 |
| Events stop after the emulator restarted               | Restart `make dev`: the emulator wrote new credentials                                            |
| Events fail after mixing `make services` and `make up` | `make down`, then start one mode                                                                  |
| Grafana panels are empty                               | The API must be up on port 3000. Check http://localhost:9090/targets                              |
