# API contract

Reference for agents. Full examples: [docs/api.md](../docs/api.md). Runnable requests: `requests.http`.

| Endpoint                             | Success | Errors        |
| ------------------------------------ | ------- | ------------- |
| `GET /health`                        | 200     | 503           |
| `GET /users/:userId/portfolio`       | 200     | 400, 404      |
| `GET /instruments?q=&limit=&offset=` | 200     | 400           |
| `POST /orders`                       | 201     | 400, 404, 422 |
| `POST /orders/:orderId/cancel`       | 200     | 400, 404, 409 |
| `GET /metrics`                       | 200     | none          |

## Rules

- `POST /orders` needs `Idempotency-Key: <uuid>`.
- `POST /orders` body: `userId`, `side`, and either `size` or `amount`. `BUY` and `SELL` also need `instrumentId` and `type`. `LIMIT` needs `price`; `MARKET` and transfers must not send it.
- A stored order always returns 201, including `REJECTED` (missing cash or shares).
- Money in responses is a string with two decimals. Order `size` and ids are numbers.
- Error body: `{ "error": { "code", "message", "details"? } }`.
- Search `limit` is 1 to 100 (default 20).
- `GET /metrics` is Prometheus text. Metric names and labels are a contract for the Grafana dashboard: renaming one means updating `docker/grafana/dashboards/cocos-api.json`.
- Changing a status code, field name or required header is a breaking change. Update `docs/api.md`, `requests.http` and the tests together.
