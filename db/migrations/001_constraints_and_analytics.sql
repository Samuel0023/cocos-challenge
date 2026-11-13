-- Additions on top of the schema provided by the challenge (db/database.sql).
-- Nothing here deletes existing rows; the seed orders keep their values.

CREATE EXTENSION IF NOT EXISTS unaccent;

-- Idempotency key sent by the client, stored next to the order it created.
ALTER TABLE orders ADD COLUMN clientorderid varchar(64);
ALTER TABLE orders ADD CONSTRAINT orders_userid_clientorderid_key UNIQUE (userid, clientorderid);

-- Balance and position queries always filter by user and status.
CREATE INDEX orders_userid_status_instrumentid_idx ON orders (userid, status, instrumentid);

ALTER TABLE orders
  ALTER COLUMN instrumentid SET NOT NULL,
  ALTER COLUMN userid SET NOT NULL,
  ALTER COLUMN size SET NOT NULL,
  ALTER COLUMN type SET NOT NULL,
  ALTER COLUMN side SET NOT NULL,
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN datetime SET NOT NULL,
  ADD CONSTRAINT orders_size_check CHECK (size > 0),
  ADD CONSTRAINT orders_side_check CHECK (side IN ('BUY', 'SELL', 'CASH_IN', 'CASH_OUT')),
  ADD CONSTRAINT orders_type_check CHECK (type IN ('MARKET', 'LIMIT')),
  ADD CONSTRAINT orders_status_check CHECK (status IN ('NEW', 'FILLED', 'REJECTED', 'CANCELLED'));

-- Transfers move pesos with cents (size = pesos, price = 1), so size holds two decimals.
-- Balances and holdings are computed from `size`, as the challenge asks. Shares stay whole.
ALTER TABLE orders ALTER COLUMN size TYPE numeric(20, 2);
ALTER TABLE orders ADD CONSTRAINT orders_whole_shares_check
  CHECK (side IN ('CASH_IN', 'CASH_OUT') OR size = trunc(size));

-- One price per instrument and day; also serves the "latest close" lookup.
ALTER TABLE marketdata ADD CONSTRAINT marketdata_instrumentid_date_key UNIQUE (instrumentid, date);

ALTER TABLE instruments ADD CONSTRAINT instruments_ticker_key UNIQUE (ticker);

-- Order events stored by the in-process consumer. event_id makes redelivery harmless.
CREATE SCHEMA analytics;
CREATE TABLE analytics.order_events (
  id bigserial PRIMARY KEY,
  event_id uuid NOT NULL UNIQUE,
  event_type varchar(32) NOT NULL,
  order_id int NOT NULL,
  user_id int NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
