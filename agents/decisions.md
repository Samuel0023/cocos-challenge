# Decisions

Reference for agents. The full table with rationale is in [docs/decisions.md](../docs/decisions.md). Do not reverse these without asking.

| Topic            | Rule                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| Reserves         | `NEW` buy `LIMIT` reserves `size × price` pesos. `NEW` sell `LIMIT` reserves `size` shares (D-01, D-02) |
| Orders by amount | Size is the whole part of `amount / price`. Zero gives 422 and stores nothing (D-06)                    |
| `REJECTED`       | Only for missing cash or shares. Invalid requests return 4xx (D-07)                                     |
| Cancel           | `POST /orders/:orderId/cancel`, only from `NEW` (D-08)                                                  |
| Transfers        | `CASH_IN` and `CASH_OUT` through `POST /orders`, ARS, `MARKET`, price 1 (D-09)                          |
| Concurrency      | User row lock, `READ COMMITTED` (D-10)                                                                  |
| Schema           | Only indexes, constraints and one nullable column (D-11)                                                |
| Positions        | Zero or negative positions are hidden (D-05)                                                            |
| Cache            | TTL 60 s for last price, 5 min for search. Valkey failure falls back to PostgreSQL (D-19)               |
| Idempotency      | `Idempotency-Key` required on `POST /orders` (D-20)                                                     |
| Events           | One `eventId` per event. Unique key and `ON CONFLICT DO NOTHING` (D-18)                                 |
| Consumer         | Async loop inside the API process, long polling SQS, `CONSUMER_ENABLED` (D-16)                          |
| Dashboard        | Grafana datasource and dashboard provisioned, anonymous read-only (D-22)                                |
| Secrets          | Environment variables only (D-15)                                                                       |
| Tooling          | ESLint recommended, typescript-eslint, Prettier, `strict` (D-24)                                        |

Known limitations: no outbox for events, average cost ignores realised gains, `LIMIT` orders never execute, and an idempotent retry of a `MARKET` order by amount is matched by user, instrument, side and type.
