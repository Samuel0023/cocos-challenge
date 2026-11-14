---
name: add-use-case
description: Add a use case (a new endpoint or behaviour) to an existing module under src/modules, test first, with its port, adapter, route, OpenAPI entry and docs. Use when asked to add an endpoint, operation or business rule to orders, portfolio, instruments, marketdata or order-events.
---

# Add a use case

A use case is one thing the service does for a caller: `SubmitOrder`, `CancelOrder`, `GetPortfolio`, `SearchInstruments`, `RecordOrderEvent`. Use this skill to add another one to a module that already exists. For a new module, use the `add-module` skill.

## Where each part goes

| Part                        | Location                                         | Example                               |
| --------------------------- | ------------------------------------------------ | ------------------------------------- |
| Rule that needs no database | `src/modules/<module>/domain/`                   | `orders/domain/funds-policy.ts`       |
| Use case class              | `src/modules/<module>/application/<use-case>.ts` | `orders/application/cancel-order.ts`  |
| Port (interface)            | `src/modules/<module>/application/`              | `orders/application/ports.ts`         |
| Adapter                     | `src/modules/<module>/infra/`                    | `orders/infra/pg-order-repository.ts` |
| Route and request schema    | `src/modules/<module>/http/`                     | `orders/http/router.ts`, `schemas.ts` |
| Tests                       | `test/<module>/`                                 | `test/orders/cancel-order.test.ts`    |

## Steps

1. **State the rule in one sentence**, with its inputs, its result and every error it can answer. If a decision is open (a status code, a rounding rule), ask before writing code.
2. **Write the test first.** Functional tests use `createTestApp()` from `test/support/test-app.ts` and Supertest; each test file gets a private copy of the seeded database. Assert every observable effect: status code, response body, stored row, published event (`ctx.events.published`) and, when relevant, that a rejected request stored nothing. Run it and watch it fail.
3. **Domain first.** If part of the rule is pure, write it in `domain/` with a unit test. Use `Money` from `src/platform/money.ts` for any amount.
4. **Port.** If the use case needs something new from outside, add a method to an existing port or a new interface in `application/`. Reuse a port that already gives you the data instead of writing a second query for the same thing.
5. **Use case.** One class with `execute`, dependencies through the constructor, ports only. Throw `notFound`, `conflict` or `unprocessable` from `src/platform/errors.ts` for business errors. They carry a code, not an HTTP status; do not import anything from `src/platform/http/` in a use case.
6. **Adapter.** Implement the new port method in `infra/`. Return NUMERIC columns as strings and turn them into `Money`.
7. **Route.** Add it to the module's `http/router.ts`. Validate with Zod. Read path ids with `src/platform/http/path-id.ts`. The handler only translates HTTP to the use case and back.
8. **Contract.** Add the operation to `src/platform/http/openapi/openapi.yaml` with every status it can answer; the contract test compares the document with the mounted routes.
9. **Docs.** Add an example and its error cases to `requests.http`, the steps to `docs/flows.md`, the endpoint to `docs/api.md`, and a decision to `docs/decisions.md` if you made one.

## Rules for use cases that write orders

These apply to anything that changes a user's cash or holdings.

| Rule                                                                                                                        | Why                                                         |
| --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Lock the user row first: inside `UnitOfWork.run`, call `tx.lockUser(userId)` before any read. `run` does not lock by itself | Two requests of one user must not spend the same pesos      |
| Keep the transaction at READ COMMITTED                                                                                      | With REPEATABLE READ the lock does not prevent double spend |
| Read balances inside the locked transaction, never before it                                                                | A balance read earlier can be stale                         |
| `REJECTED` only for missing cash or shares; malformed requests are 4xx and store nothing                                    | A client mistake is not an order                            |
| Publish events and count metrics after commit, and never let them fail the request                                          | The order is already stored                                 |
| A request that can be retried takes an `Idempotency-Key` and checks it after the lock                                       | A retry must return the stored order                        |

## Check

```sh
make lint
make typecheck
make test
```

For a change to orders, also run the concurrency tests on their own and read the result:

```sh
npx vitest run test/orders/concurrency.test.ts
```

`npx vitest` needs the Docker socket variables that `make test` sets; see `docs/local-setup.md` if it cannot find a container runtime.

## Common mistakes

| Symptom                                      | Cause                                                                                    |
| -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| A race test passes with and without the lock | The window is too small: use the `pg_sleep` trigger in `test/orders/concurrency.test.ts` |
| Cents drift by one                           | A JavaScript number was used for money: use `Money`                                      |
| A retry creates a second order               | The key was checked before taking the user lock                                          |
| The OpenAPI contract test fails              | The route or one of its status codes is missing in `openapi.yaml`                        |
