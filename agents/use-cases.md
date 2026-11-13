# Use cases

Reference for agents. Each use case is a class in `src/*/application/`. Step-by-step flows are in [docs/flows.md](../docs/flows.md).

| Use case            | File                                                | Input                | Output                            |
| ------------------- | --------------------------------------------------- | -------------------- | --------------------------------- |
| `GetPortfolio`      | `src/portfolio/application/get-portfolio.ts`        | `userId`             | Portfolio, or `null` if no user   |
| `SearchInstruments` | `src/instruments/application/search-instruments.ts` | text, limit, offset  | `{ items, limit, offset, total }` |
| `SubmitOrder`       | `src/orders/application/submit-order.ts`            | `SubmitOrderCommand` | Stored `Order` (any status)       |
| `CancelOrder`       | `src/orders/application/cancel-order.ts`            | `orderId`            | Order with status `CANCELLED`     |
| `RecordOrderEvent`  | `src/events/record-order-event.ts`                  | Queue message body   | Saved `OrderEvent`                |

## Rules to keep

- `SubmitOrder` and `CancelOrder` run inside `UnitOfWork.run`, which takes the user row lock first.
- The funds check lives in `src/orders/domain/funds-policy.ts`. The status comes from `initialStatus` in `src/orders/domain/order.ts`.
- Size from an amount is `Money.wholeUnitsAt`, through `sizeFromAmount`.
- Events go out through `publishOrderEvent`, after commit, and never throw.
- Position math is in `src/portfolio/domain/position-valuation.ts`.
- Use cases throw `AppError` helpers (`notFound`, `conflict`, `unprocessable`, `badRequest`) from `src/shared/http/errors.ts`. The error middleware turns them into responses.

`RecordOrderEvent` is called by the SQS consumer loop, which is part of the events work and may not exist yet. See [docs/architecture.md](../docs/architecture.md).
