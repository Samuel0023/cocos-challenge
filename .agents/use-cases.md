# Use cases

Reference for agents. Each use case is a class in `src/modules/*/application/`. Step-by-step flows are in [docs/flows.md](../docs/flows.md).

| Use case            | File                                                         | Input                | Output                            |
| ------------------- | ------------------------------------------------------------ | -------------------- | --------------------------------- |
| `GetPortfolio`      | `src/modules/portfolio/application/get-portfolio.ts`         | `userId`             | Portfolio, or `null` if no user   |
| `SearchInstruments` | `src/modules/instruments/application/search-instruments.ts`  | text, limit, offset  | `{ items, limit, offset, total }` |
| `SubmitOrder`       | `src/modules/orders/application/submit-order.ts`             | `SubmitOrderCommand` | Stored `Order` (any status)       |
| `CancelOrder`       | `src/modules/orders/application/cancel-order.ts`             | `orderId`            | Order with status `CANCELLED`     |
| `RecordOrderEvent`  | `src/modules/order-events/application/record-order-event.ts` | Queue message body   | Saved `OrderEvent`                |

## Rules to keep

- `SubmitOrder` and `CancelOrder` run inside `UnitOfWork.run`, which only opens the transaction. The use case takes the user row lock itself by calling `tx.lockUser(userId)` as its first statement, before any read. A use case that skips that call has no lock.
- The funds check lives in `src/modules/orders/domain/funds-policy.ts`. The status comes from `initialStatus` in `src/modules/orders/domain/order.ts`.
- Share size from an amount is `Money.wholeUnitsAt`, through `sizeFromAmount`. A transfer's size is the `Money` sent (`SizedSide` in `src/modules/orders/domain/order.ts`).
- Events go out through `publishOrderEvent`, after commit, and never throw.
- Orders are counted through `countOrder` (in `order-events.ts`), after commit, only when stored or cancelled. It never throws.
- Position math is in `src/modules/portfolio/domain/position-valuation.ts`.
- Use cases throw `AppError` helpers (`notFound`, `conflict`, `unprocessable`) from `src/platform/errors.ts`. An `AppError` carries a code, not a status: `src/platform/http/error-middleware.ts` maps the code to the HTTP status. `badRequest` is for the HTTP layer (headers, path ids); body and query validation throws a `ZodError`.

`RecordOrderEvent` is called by `OrderEventConsumer` in `src/modules/order-events/application/order-event-consumer.ts`, which polls the `OrderEventQueue` port (`SqsOrderEventQueue` in `src/modules/order-events/infra/sqs-order-event-queue.ts`) and records the consumer metrics. See [docs/flows.md](../docs/flows.md), section "Event consumer".
