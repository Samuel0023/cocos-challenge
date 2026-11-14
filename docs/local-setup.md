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
  end
  API --> PG
  API --> VK
  API --> EM
```

`make up` runs the same services plus the API in a container. Run `make down` before switching modes: starting one over the other recreates the emulator and wipes its topic and queue.

## Services

| Service        | Port | Notes                                                                               |
| -------------- | ---- | ----------------------------------------------------------------------------------- |
| `postgres`     | 5432 | Loads the challenge seed and the migration. User, password and database are `cocos` |
| `valkey`       | 6379 | Cache. Optional: without `VALKEY_URL` the API runs with no cache                    |
| `aws-emulator` | 9297 | SNS and SQS                                                                         |
| `aws-init`     | none | Creates the topic, the queue and the dead-letter queue, then exits                  |

The database has no volume: `make down` and a new start restore the seed.

`make services` also starts Prometheus (http://localhost:9090) and Grafana (http://localhost:3001/d/cocos-api/cocos-api, no login).

## Load test

`make load` runs a k6 load test against an API started with `make dev` or `make up`: 20 virtual users for 30 seconds, mixing portfolio, search and a market buy followed by a sell. It writes thousands of orders; `make down` and `make services` restore the seed.

One local run on 13 November 2026 gave these numbers. They show what to expect, not a benchmark.

| Measure               | Value                                                         |
| --------------------- | ------------------------------------------------------------- |
| Peak request rate     | About 1,000 requests per second, no errors                    |
| p95 latency per route | `POST /orders` 70.6 ms, portfolio 29.1 ms, search 9.58 ms     |
| Order events          | All processed. The backlog peaked near 1,000 and drained to 0 |

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

SNS and SQS run on AWS Emulator. It keeps its state in memory and creates new credentials on every start, so restart `make dev` whenever the emulator restarts. `make test-aws` checks the whole path: it publishes to SNS and waits for the consumer to store the event.

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
