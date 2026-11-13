# Data model

Reference for agents. Schema: `db/database.sql` (from the challenge). Changes: `db/migrations/001_constraints_and_analytics.sql`. Rationale: [docs/decisions.md](../docs/decisions.md).

## Tables

| Table                    | Use                                                                            |
| ------------------------ | ------------------------------------------------------------------------------ |
| `users`                  | Account owners. Locked per order with `SELECT ... FOR UPDATE`                  |
| `instruments`            | Tickers. `ARS` (type `MONEDA`) is the peso instrument; unique `ticker`         |
| `marketdata`             | One row per instrument and day. Latest price is the row with the latest `date` |
| `orders`                 | All movements: `BUY`, `SELL`, `CASH_IN`, `CASH_OUT`                            |
| `analytics.order_events` | Events stored by the consumer. Unique `event_id`                               |

## orders

| Column          | Notes                                                  |
| --------------- | ------------------------------------------------------ |
| `side`          | `BUY`, `SELL`, `CASH_IN`, `CASH_OUT`                   |
| `type`          | `MARKET`, `LIMIT`                                      |
| `status`        | `NEW`, `FILLED`, `REJECTED`, `CANCELLED`               |
| `size`          | Integer greater than 0. Shares, or pesos for transfers |
| `price`         | `numeric(10,2)`. Transfers use 1                       |
| `clientorderid` | Idempotency key, nullable, unique with `userid`        |

Index: `(userid, status, instrumentid)`.

## Derived values

There is no balances table. Everything is computed from `orders`.

| Value           | Orders counted     |
| --------------- | ------------------ |
| Cash balance    | `FILLED`           |
| Reserved cash   | `NEW` buy `LIMIT`  |
| Held quantity   | `FILLED`           |
| Reserved shares | `NEW` sell `LIMIT` |
| Average cost    | `FILLED` buys      |

Formulas: [docs/flows.md](../docs/flows.md), section "Portfolio".

## Seed facts

- User 1 has the control portfolio: cash 753000.00, available 627500.00, total 904784.00, positions PAMP (40) and METR (500).
- User 1 holds −10 BMA in the seed. It is hidden.
- PGR and IRCP have no `marketdata`.
- Instrument ids: PAMP 47, METR 54, BMA 31, PGR 3, ARS 66.
- Money in code is `Money` (bigint cents). The database uses `numeric`.
