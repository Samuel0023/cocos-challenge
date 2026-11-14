# API

Requests, responses and status codes. With the API running, the same contract is interactive at http://localhost:3000/docs (Swagger UI) and raw at http://localhost:3000/openapi.yaml. `requests.http` has one ready request per case.

| Method and path                      | What it does                                |
| ------------------------------------ | ------------------------------------------- |
| `GET /users/:userId/portfolio`       | Account value, available cash and positions |
| `GET /instruments?q=&limit=&offset=` | Searches instruments by ticker or name      |
| `POST /orders`                       | Submits an order or a cash transfer         |
| `POST /orders/:orderId/cancel`       | Cancels an order in `NEW`                   |
| `GET /health`                        | 200 when the database answers, 503 if not   |
| `GET /metrics`                       | Prometheus metrics                          |

- Bodies are JSON. Money is a decimal string with two decimals (`"925.85"`).
- There is no authentication. See [known limitations](decisions.md#known-limitations).

## GET /users/:userId/portfolio

```json
{
  "userId": 1,
  "totalAccountValue": "904784.00",
  "availableCash": "627500.00",
  "cashBalance": "753000.00",
  "reservedCash": "125500.00",
  "positions": [
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

Positions are sorted by ticker. One without market data has `null` in `lastPrice`, `marketValue` and the returns.

## GET /instruments

| Query param | Rule                 |
| ----------- | -------------------- |
| `q`         | Required, not empty  |
| `limit`     | 1 to 100, default 20 |
| `offset`    | 0 or more, default 0 |

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
  "limit": 20,
  "offset": 0,
  "total": 1
}
```

`total` counts every match, not only the page. Nothing found is a 200 with empty `items`.

## POST /orders

The header `Idempotency-Key: <uuid>` is required.

| Field          | Rule                                                                                                                 |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| `userId`       | Required                                                                                                             |
| `side`         | `BUY`, `SELL`, `CASH_IN` or `CASH_OUT`                                                                               |
| `instrumentId` | Required for `BUY` and `SELL`. Transfers use ARS                                                                     |
| `type`         | `MARKET` or `LIMIT`, for `BUY` and `SELL`                                                                            |
| `size`         | Whole shares. `BUY` and `SELL` only                                                                                  |
| `amount`       | Pesos, up to two decimals. `BUY` and `SELL`: buys the shares that fit, instead of `size`. Transfers: the pesos moved |
| `price`        | Required for `LIMIT`, not allowed otherwise                                                                          |

```http
POST /orders
Idempotency-Key: 5b3f1c1e-9f0a-4c1d-8a55-2f4e6d7c8b90
Content-Type: application/json

{ "userId": 1, "instrumentId": 47, "side": "BUY", "type": "MARKET", "size": 2 }
```

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

A transfer sends only `amount`: `{ "userId": 2, "side": "CASH_IN", "amount": "2777.55" }`. Its response has `"size": "2777.55"` and `"price": "1.00"`.

An order without enough cash or shares is not an error: it answers 201 with `"status": "REJECTED"`, because it was stored.

## POST /orders/:orderId/cancel

No body. Answers 200 with the order in `"status": "CANCELLED"`, or 409 when the order is not `NEW`.

## Errors

```json
{
  "error": {
    "code": "UNPROCESSABLE_ENTITY",
    "message": "Amount is not enough for one unit at the order price"
  }
}
```

| Status | Code                     | When                                                                                                                                      |
| ------ | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `BAD_REQUEST`            | Invalid body, query or path id; missing or non-UUID `Idempotency-Key`; fractional shares                                                  |
| 404    | `NOT_FOUND`              | Unknown user, instrument, order or route                                                                                                  |
| 409    | `CONFLICT`               | Cancelling an order that is not `NEW`                                                                                                     |
| 413    | `PAYLOAD_TOO_LARGE`      | Body above 100 kB                                                                                                                         |
| 415    | `UNSUPPORTED_MEDIA_TYPE` | Body in an encoding the API does not read                                                                                                 |
| 422    | `UNPROCESSABLE_ENTITY`   | Valid request that cannot be an order: no market price, `amount` below one share, key reused with another request, `BUY` or `SELL` on ARS |
| 500    | `INTERNAL_ERROR`         | Unhandled error                                                                                                                           |

Validation errors also carry `details` with the failing fields.
