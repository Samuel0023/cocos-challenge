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

| Field          | Type    | Rule                                                                              |
| -------------- | ------- | --------------------------------------------------------------------------------- |
| `userId`       | integer | Required                                                                          |
| `instrumentId` | integer | Required for `BUY` and `SELL`. Transfers use the ARS instrument when omitted      |
| `side`         | string  | `BUY`, `SELL`, `CASH_IN` or `CASH_OUT`                                            |
| `type`         | string  | `MARKET` or `LIMIT`. Required for `BUY` and `SELL`. Transfers are always `MARKET` |
| `size`         | integer | Shares or pesos. Send exactly one of `size` and `amount`                          |
| `amount`       | decimal | Pesos to invest. Size becomes the whole part of `amount / price`                  |
| `price`        | decimal | Required for `LIMIT`. Not allowed for `MARKET` or transfers                       |

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

A `LIMIT` order with funds returns `"status": "NEW"`. An order without enough cash or shares returns 201 with `"status": "REJECTED"`. Repeating the same request with the same key returns the same order and stores nothing new. See [flows.md](flows.md) for the full steps.

| Status | When                                                                                                                                                                      |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 201    | The order was stored (any status), or it is a valid retry                                                                                                                 |
| 400    | Invalid body, missing or invalid `Idempotency-Key`, malformed JSON                                                                                                        |
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
| 400    | `orderId` is not a positive integer                   |
| 404    | The order does not exist                              |
| 409    | The order is not `NEW` (the message names its status) |

## GET /metrics

> Designed in the RFC, not built yet.

Prometheus metrics in text format. Responds 200.
