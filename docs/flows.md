# Flows

One diagram per flow, followed by the rules the diagram cannot show.

## Submit order

`POST /orders`, handled by `SubmitOrder`.

```mermaid
sequenceDiagram
  autonumber
  participant C as Client
  participant UC as SubmitOrder
  participant PG as PostgreSQL
  participant SNS as SNS
  C->>UC: POST /orders (Idempotency-Key)
  Note over UC: validate, 400 stores nothing
  Note over UC: latest close, cached (MARKET only)
  UC->>PG: BEGIN, lock user row
  UC->>PG: order with this key already stored?
  alt key already used
    UC-->>C: 201 stored order, or 422 if the request differs
  else new order
    UC->>PG: available cash or shares
    Note over UC: FILLED, NEW or REJECTED
    UC->>PG: INSERT order, COMMIT
    UC->>SNS: order.created (a failure is only logged)
    UC-->>C: 201 order
  end
```

| Order                | Funds or shares | Stored status |
| -------------------- | --------------- | ------------- |
| `MARKET`, `CASH_OUT` | Enough          | `FILLED`      |
| `LIMIT`              | Enough          | `NEW`         |
| Any of the above     | Not enough      | `REJECTED`    |
| `CASH_IN`            | Not checked     | `FILLED`      |

- **Price.** `MARKET` uses the latest `close`, `LIMIT` the price sent, transfers 1.
- **Size.** Sent as whole shares, or derived from `amount` as the whole part of `amount / price`. For a transfer, `amount` is the pesos moved, cents included.
- **Funds.** `size × price` is compared with the available cash in exact cents. Available cash and shares already subtract what `NEW` `LIMIT` orders reserve.
- **Retry.** The same key with the same request returns the stored order. It is not counted or published again.

## Statuses

```mermaid
stateDiagram-v2
  [*] --> FILLED: MARKET or transfer with funds
  [*] --> NEW: LIMIT with funds
  [*] --> REJECTED: missing cash or shares
  NEW --> CANCELLED: POST /orders/:orderId/cancel
```

`NEW` orders are never executed: there is no market simulation.

## Cancel order

`POST /orders/:orderId/cancel`, handled by `CancelOrder`.

```mermaid
sequenceDiagram
  autonumber
  participant C as Client
  participant UC as CancelOrder
  participant PG as PostgreSQL
  participant SNS as SNS
  C->>UC: POST /orders/:orderId/cancel
  UC->>PG: find the order and its user
  UC-->>C: 404 if it does not exist
  UC->>PG: BEGIN, lock user row, re-read the order
  alt status is NEW
    UC->>PG: UPDATE status = CANCELLED, COMMIT
    UC->>SNS: order.cancelled
    UC-->>C: 200 order
  else any other status
    UC-->>C: 409
  end
```

The order is read again under the lock, so a cancel cannot race with another request of the same user. Cancelling releases the reservation, because reservations are derived from `NEW` orders.

## Portfolio

`GET /users/:userId/portfolio`, handled by `GetPortfolio`.

```mermaid
sequenceDiagram
  autonumber
  participant C as Client
  participant UC as GetPortfolio
  participant PG as PostgreSQL
  C->>UC: GET /users/:userId/portfolio
  UC->>PG: user, cash balance, reserved cash, holdings
  UC-->>C: 404 if the user does not exist
  Note over UC: latest quote per instrument, cached
  Note over UC: value each position
  UC-->>C: 200 portfolio
```

| Value               | Formula                                                     |
| ------------------- | ----------------------------------------------------------- |
| Cash balance        | `CASH_IN` + sells − `CASH_OUT` − buys, over `FILLED` orders |
| Reserved cash       | `size × price` of `NEW` buy `LIMIT` orders                  |
| Available cash      | Cash balance − reserved cash                                |
| Quantity            | Buys − sells, over `FILLED` orders                          |
| Average cost        | Cost of the buys / shares bought                            |
| Market value        | Quantity × latest `close`                                   |
| Total return (%)    | `(close − average cost) / average cost × 100`               |
| Daily return (%)    | `(close − previousClose) / previousClose × 100`             |
| Total account value | Cash balance + market value of the positions                |

Positions with a quantity of zero or below are not listed. Balances and orders are always read from PostgreSQL; only quotes are cached.

## Search instruments

`GET /instruments?q=&limit=&offset=`, handled by `SearchInstruments`.

```mermaid
sequenceDiagram
  autonumber
  participant C as Client
  participant UC as SearchInstruments
  participant PG as PostgreSQL
  C->>UC: GET /instruments?q=
  UC->>PG: match on ticker and name
  UC-->>C: 200 items, limit, offset, total
```

The match is partial and ignores case and accents. Exact ticker matches come first, then ticker prefixes, then the rest. Responses are cached for 5 minutes.

## Event consumer

`OrderEventConsumer`, started when `AWS_ENABLED=true` and `CONSUMER_ENABLED=true`.

```mermaid
sequenceDiagram
  autonumber
  participant Q as SQS order-events-queue
  participant L as Consumer loop
  participant PG as analytics.order_events
  loop while running
    L->>Q: ReceiveMessage
    Q-->>L: messages
    L->>PG: INSERT ... ON CONFLICT (event_id) DO NOTHING
    alt stored or already present
      L->>Q: DeleteMessage
    else failure
      Note over L,Q: not deleted, SQS redelivers it
    end
  end
```

A message that keeps failing ends in a dead-letter queue. A consumer error is logged and retried: the loop never stops the API.
