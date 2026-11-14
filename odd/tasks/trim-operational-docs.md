# Trim operational documentation

Locator: `odd/tasks/trim-operational-docs.md` · Engram topic: `odd/trim-operational-docs/tasks`
Branch: `docs/trim-operational-docs` (from `main` at `accde1b`)

## Objective

Make the documentation and diagrams focus on the business core (orders, portfolio, instruments, cash transfers, order events). Operational and niche topics get at most a one-line mention.

## Problem and why

An audit found roughly 150-200 of about 1,100 Markdown lines, two whole diagram pages and several diagram cells spent on `/health`, `/metrics`, Prometheus, Grafana, k6, AWS Emulator internals and cache hit/miss plumbing. The owner considers this noise for a reader of the challenge: these deserve a mention, not sections, and should not be drawn in the diagrams.

## Scope (authorized by the owner on 2026-11-14)

- Markdown docs: `README.md`, `docs/*.md`, `.agents/*.md`, `.agents/skills/run-service/SKILL.md`, and the one descriptive sentence in `AGENTS.md`.
- Diagrams: `docs/diagrams/cocos-solution.drawio` and its PNG exports; the load-test screenshots in `docs/images/`.

## Out of scope and constraints

- No source, test, config, Makefile, compose or dashboard changes. The features stay; only their documentation shrinks.
- `src/platform/http/openapi/openapi.yaml` is untouched: the contract test requires every mounted route to be declared.
- The "Key rules" about metrics in `AGENTS.md` stay: they are invariants for agents.
- `requests.http` is untouched.
- Docs stay in English. Never edit `db/database.sql`.

## Delivery

Strategy: `single-pr`. Forecast: about 200 authored changed Markdown lines (mostly deletions); the drawio XML and PNGs are tool-generated diagram assets and are not counted. Push and PR are the owner's decision.

## Tasks

- [x] **T1 — Trim the Markdown docs.** Route: delegated (writer trigger: 6+ non-trivial files).
  - `docs/local-setup.md`: remove the Load test section and its three screenshots, remove the Metrics section, drop the Prometheus and Grafana nodes from the mermaid, merge their two service rows into one, shorten the AWS Emulator internals to 1-2 lines, drop the empty-Grafana troubleshooting row. Keep one line saying `make load` runs the k6 load test and where the dashboards are.
  - `docs/architecture.md`: remove the Metrics section (one line at most), remove the metrics adapter node and edge from the Layers mermaid, remove the reference AWS deployment diagram.
  - `README.md`, `docs/api.md`, `.agents/api-contract.md`: take `/health` and `/metrics` out of the endpoint tables and mention them in one line below. Reduce the README "Events and metrics" section to about two lines and drop "Prometheus metrics" from the intro pitch. Fix the diagrams paragraph so it matches the pages that remain.
  - `docs/flows.md`: show the cached price as a single step without hit/miss branches; trim SQS mechanics (long polling, dead-letter queue, retry timings) to what a reader needs.
  - `.agents/skills/run-service/SKILL.md`: reduce the Prometheus and Grafana checks to one optional line.
  - `.agents/decisions.md`, `.agents/use-cases.md`, `AGENTS.md:7`: drop or shorten the dashboard and metrics sentences.
  - Delete `docs/images/load-test-*.png`.
  - Checks: no dangling links or image references; `make lint`; structural readback.
- [ ] **T2 — Trim the diagrams.** Route: delegated (same writer, after T1).
  - Delete the "Local environment" and "AWS architecture" pages and their PNGs.
  - Hexagonal architecture: remove the Prometheus box, the PrometheusMetrics adapter, the Metrics ports and the scrape edge.
  - Flow: event consumer: remove the Metrics box, its legend entry, its edge, and the metrics wording in the loop note.
  - Flows submit, portfolio, search: collapse the cache hit/miss cells into one "cached price" step; remove unused legend entries.
  - Re-export every remaining page to its PNG with the draw.io desktop CLI.
  - Checks: the drawio file is well-formed XML and opens; no edge points at a deleted cell; each remaining page has a fresh PNG; visual readback of the changed PNGs.

## Acceptance criteria

- `/health`, `/metrics`, Prometheus, Grafana and k6 appear in the Markdown docs only as short mentions, never as sections, tables or diagram nodes.
- The drawio has six pages, none of them drawing metrics, Prometheus or Grafana.
- Every image link in the docs resolves to a file that exists.
- `make lint` and `make typecheck` pass; `make test` passes or is reported as not run.

## Progress and evidence

- 2026-11-14: read-only audit completed; owner approved the trims including deleting the two diagram pages.
- T1: done in the commit `docs: trim operational detail from the docs` (hash recorded with T2). Risk tier: passive. Observed: relative link and image check over 14 Markdown files, 17 links, 0 broken; `eslint .` clean; `prettier --check .` clean for every tracked file. `make lint` itself exits 1 only because of the untracked `.atl/skill-registry.md`, which is outside this feature. Also dropped the long-polling label and the dead-letter edge from the Events mermaid in `docs/architecture.md`.
- T2: pending.

## Next step

Run T2.
