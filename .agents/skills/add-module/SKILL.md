---
name: add-module
description: Add a new business module under src/modules with the project's layers, ports, adapters, router, tests and docs. Use when asked to add a new feature area, bounded context or module (for example watchlists, alerts or statements), not for a new endpoint inside an existing module.
---

# Add a module

A module is one business capability under `src/modules/<name>/`. Use this skill when the capability does not fit an existing module. To add behaviour to a module that already exists, use the `add-use-case` skill instead.

Technical pieces with no business rules (a new client, a middleware, a cache) are not modules: they go under `src/platform/`.

## Layout

Create only the layers the module needs. `instruments` has no `domain/` because it has no rules of its own.

```
src/modules/<name>/
  domain/        pure rules and types. No imports from infra, http, Express or pg
  application/   use cases and the ports they need (interfaces)
  infra/         adapters that implement the ports (PostgreSQL, Valkey, AWS)
  http/          router.ts, request schemas (Zod), route-only middleware
test/<name>/     unit tests for the domain, functional tests for the routes
```

## Rules that keep the layout honest

| Rule                                                                                            | How it is checked          |
| ----------------------------------------------------------------------------------------------- | -------------------------- |
| `domain/` imports only `src/platform/money.ts` and `domain/` types, its own or another module's | Review                     |
| Use cases depend on ports, never on an adapter                                                  | Review                     |
| A module uses another module only through its `application/` ports or `domain/` types           | Review                     |
| `src/platform/` never imports from `src/modules/`                                               | ESLint (`make lint` fails) |
| Money is `Money` (bigint cents) in code and a decimal string in JSON, never a float             | Review, unit tests         |

## Steps

1. **Name the module and its first use case.** Pick a noun for the folder (`watchlists`) and a verb phrase for the use case (`AddToWatchlist`).
2. **Write the first test.** Create `test/<name>/<use-case>.test.ts` with `createTestApp()` from `test/support/test-app.ts` and Supertest. Assert the status code, the body and the stored row. Run it and watch it fail.
3. **Domain.** Put rules that need no database in `domain/` and unit-test them without `createTestApp()`.
4. **Ports.** In `application/`, declare one interface per thing the use case needs from outside (`WatchlistRepository`). Name it by what it gives the use case, not by the technology.
5. **Use case.** One class per use case in `application/`, with an `execute` method. Dependencies arrive through the constructor. No TypeScript parameter properties: declare the field and assign it (Node runs the files by type stripping).
6. **Adapters.** Implement each port in `infra/`, prefixed by the technology (`PgWatchlistRepository`). SQL goes through `Queryable` from `src/platform/postgres/db.ts`; writes that must be atomic use `withTransaction`.
7. **Router.** Export `create<Name>Router(deps: AppDeps): Router` from `http/router.ts`. Build the adapters and the use case there, validate input with Zod (a thrown `ZodError` becomes 400), and throw the helpers in `src/platform/errors.ts` (`notFound`, `conflict`, `unprocessable`) for other errors; never set a status by hand. Path ids go through `src/platform/http/path-id.ts`.
8. **Register it.** Mount the router in `buildApp` in `src/app.ts`, before `routeNotFound`. If the module needs something built once and shared, add it to `AppDeps`, build it in `src/main.ts`, and give it a default in `createTestApp()` so existing tests keep passing.
9. **Schema.** New tables or columns go in a new file under `db/migrations/`, mounted in `compose.yaml` and copied in `test/support/global-setup.ts`. Never edit `db/database.sql`: it is the schema the challenge provided.
10. **Contract and docs.** Add the routes to `src/platform/http/openapi/openapi.yaml` (the contract test fails otherwise) and an example to `requests.http`. Then add the module name in every place that lists the modules: the folder tree in `docs/architecture.md`, the "Architecture in brief" paragraph of `AGENTS.md`, and the `description` of `.agents/skills/add-use-case/SKILL.md`. Document its endpoints in `docs/api.md` and its steps in `docs/flows.md`.

## Check

```sh
make lint
make typecheck
make test
```

All three must pass. Then start the service with the `run-service` skill and call the new route once.

## Common mistakes

| Symptom                                               | Cause                                                                |
| ----------------------------------------------------- | -------------------------------------------------------------------- |
| `make lint` fails with `no-restricted-imports`        | A file under `src/platform/` imports from `src/modules/`             |
| The OpenAPI contract test fails                       | A route was mounted without adding it to `openapi.yaml`              |
| `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` at startup        | A parameter property, enum or namespace: use plain fields and unions |
| `Cannot find module` at startup, tests pass           | A relative import without the `.ts` extension                        |
| Existing tests fail after adding a field to `AppDeps` | The field has no default in `createTestApp()`                        |
