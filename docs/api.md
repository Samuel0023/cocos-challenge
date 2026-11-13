# API

This document describes each endpoint: request, response and status codes. Examples come from the behaviour checked by the tests, on the challenge seed. Ids of new orders and dates change from run to run. `requests.http` has a ready-to-run request for each case.

Conventions:

- Bodies are JSON. Money is a decimal string with two decimals (`"925.85"`). Prices and amounts in requests accept a string or a number with up to two decimals.
- Errors share one shape. `details` is present only on validation errors.

```json
{ "error": { "code": "BAD_REQUEST", "message": "Invalid request", "details": [] } }
```

| Code                   | Status |
| ---------------------- | ------ |
| `BAD_REQUEST`          | 400    |
| `NOT_FOUND`            | 404    |
| `CONFLICT`             | 409    |
| `UNPROCESSABLE_ENTITY` | 422    |
| `INTERNAL_ERROR`       | 500    |

## OpenAPI and Swagger UI

The machine-readable description of these endpoints is `src/openapi/openapi.yaml` (OpenAPI 3.1). With the API running, Swagger UI is at http://localhost:3000/docs and the raw document at http://localhost:3000/openapi.yaml. `test/docs/openapi.test.ts` checks that the document and the mounted routes match.

## GET /health

Checks the database connection.

| Status | Body                          |
| ------ | ----------------------------- |
| 200    | `{ "status": "ok" }`          |
| 503    | `{ "status": "unavailable" }` |

## GET /users/:userId/portfolio

Returns the account value, cash and open positions of a user. `userId` is a positive integer.

Response 200 for user 1:

```json
{
  "userId": 1,
  "totalAccountValue": "904784.00",
  "availableCash": "627500.00",
  "cashBalance": "753000.00",
  "reservedCash": "125500.00",
  "positions": [
    {
      "instrumentId": 54,
      "ticker": "METR",
      "name": "MetroGAS S.A.",
      "quantity": 500,
      "averageCost": "250.00",
      "lastPrice": "229.50",
      "marketValue": "114750.00",
      "totalReturnPct": "-8.20",
      "dailyReturnPct": "-1.08"
    },
    {
      "instrumentId": 47,
      "ticker": "PAMP",
      "name": "Pampa Holding S.A.",
      "quantity": 40,
      "averageCost": "930.00",
      "lastPrice": "925.85",
      "marketValue": "37034.00",
      "totalReturnPct": "-0.45",
      "dailyReturnPct": "0.44"
    }
  ]
}
```

Users 2 to 4 have no orders: all amounts are `"0.00"` and `positions` is `[]`. Positions are sorted by ticker. A position without market data has `null` in `lastPrice`, `marketValue` and the returns.

| Status | When                               |
| ------ | ---------------------------------- |
| 200    | The user exists                    |
| 400    | `userId` is not a positive integer |
| 404    | The user does not exist            |

## GET /instruments

Searches instruments by ticker or name. The match is partial and ignores case and accents. Exact ticker matches come first.

| Query param | Rule                 |
| ----------- | -------------------- |
| `q`         | Required, not empty  |
| `limit`     | 1 to 100, default 20 |
| `offset`    | 0 or more, default 0 |

Request: `GET /instruments?q=pamp&limit=2`

```json
{
  "items": [
    {
      "id": 47,
      "ticker": "PAMP",
      "name": "Pampa Holding S.A.",
      "type": "ACCIONES",
      "lastPrice": "925.85"
    }
  ],
  "limit": 2,
  "offset": 0,
  "total": 1
}
```

`lastPrice` is `null` when the instrument has no market data (for example PGR). `total` counts all matches, not only the page.

| Status | When                                                            |
| ------ | --------------------------------------------------------------- |
| 200    | Always, with an empty `items` when nothing matches              |
| 400    | `q` is missing or empty, or `limit` or `offset` is out of range |

## POST /orders

Submits an order or a cash transfer. The header `Idempotency-Key: <uuid>` is required.

| Field          | Type    | Rule                                                                                                                                                                                                        |
| -------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `userId`       | integer | Required                                                                                                                                                                                                    |
| `instrumentId` | integer | Required for `BUY` and `SELL`. Transfers use the ARS instrument when omitted                                                                                                                                |
| `side`         | string  | `BUY`, `SELL`, `CASH_IN` or `CASH_OUT`                                                                                                                                                                      |
| `type`         | string  | `MARKET` or `LIMIT`. Required for `BUY` and `SELL`. Transfers are always `MARKET`                                                                                                                           |
| `size`         | number  | Whole shares (JSON integer). `BUY` and `SELL` only; a transfer with `size` is 400                                                                                                                           |
| `amount`       | decimal | Pesos, up to 2 decimals. `BUY`/`SELL`: invests up to this much, size is the whole part of `amount / price`; send exactly one of `size` and `amount`. Transfers: required, it is the pesos moved, cents kept |
| `price`        | decimal | Required for `LIMIT`. Not allowed for `MARKET` or transfers                                                                                                                                                 |

Request:

```http
POST /orders
Idempotency-Key: 5b3f1c1e-9f0a-4c1d-8a55-2f4e6d7c8b90
Content-Type: application/json

{ "userId": 1, "instrumentId": 47, "side": "BUY", "type": "MARKET", "size": 2 }
```

Response 201:

```json
{
  "id": 1234,
  "userId": 1,
  "instrumentId": 47,
  "side": "BUY",
  "type": "MARKET",
  "status": "FILLED",
  "size": 2,
  "price": "925.85",
  "datetime": "2026-11-13T15:04:05.123Z"
}
```

In responses, `size` is a JSON integer for `BUY` and `SELL` and a decimal string with two places for `CASH_IN` and `CASH_OUT`. A transfer takes its pesos in `amount`, with up to two decimals (more is 400), and stores them in the `size` column with price 1. A transfer sent with `size` is 400, because `size` counts shares. A fractional share size is 400.

Limits follow the columns: a transfer `amount` goes up to 999999999999999999.99 (`size` is `numeric(20, 2)`); an `amount` or `price` of a `BUY` or `SELL` goes up to 99999999.99 (`price` is `numeric(10, 2)`).

Transfer with cents:

```http
POST /orders
Idempotency-Key: 0d4b8c52-3a1e-4f7a-9c2b-6e5d4a3b2c1f
Content-Type: application/json

{ "userId": 2, "side": "CASH_IN", "amount": "2777.55" }
```

Response 201:

```json
{
  "id": 1235,
  "userId": 2,
  "instrumentId": 66,
  "side": "CASH_IN",
  "type": "MARKET",
  "status": "FILLED",
  "size": "2777.55",
  "price": "1.00",
  "datetime": "2026-11-13T15:04:06.456Z"
}
```

A `LIMIT` order with funds returns `"status": "NEW"`. An order without enough cash or shares returns 201 with `"status": "REJECTED"`. Repeating the same request with the same key returns the same order and stores nothing new. See [flows.md](flows.md) for the full steps.

| Status | When                                                                                                                                                                      |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 201    | The order was stored (any status), or it is a valid retry                                                                                                                 |
| 400    | Invalid body (including a fractional share size or more than two decimals), missing or invalid `Idempotency-Key`, malformed JSON                                          |
| 404    | Unknown user or instrument                                                                                                                                                |
| 422    | `BUY` or `SELL` on ARS, transfer on another instrument, `MARKET` without market data, `amount` below one unit, size above 2147483647, key reused with a different request |

Example 422 body:

```json
{
  "error": {
    "code": "UNPROCESSABLE_ENTITY",
    "message": "Amount is not enough for one unit at the order price"
  }
}
```

## POST /orders/:orderId/cancel

Cancels an order in `NEW`. No body and no idempotency key: cancelling twice returns 409 the second time.

Response 200 is the order with `"status": "CANCELLED"`, in the same shape as above.

| Status | When                                                  |
| ------ | ----------------------------------------------------- |
| 200    | The order was `NEW` and is now `CANCELLED`            |
| 400    | `orderId` is not a whole number (`0` is 404)          |
| 404    | The order does not exist                              |
| 409    | The order is not `NEW` (the message names its status) |

## GET /metrics

Prometheus metrics in text format (`Content-Type: text/plain; version=0.0.4; charset=utf-8`). Responds 200. The metric list is in [architecture.md](architecture.md#metrics).

```text
orders_total{status="FILLED",side="BUY",type="MARKET"} 2
http_request_duration_seconds_count{method="GET",route="/users/:userId/portfolio",status_code="200"} 1
```
