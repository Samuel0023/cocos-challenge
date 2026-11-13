import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { TestApp } from '../support/test-app.ts';

export const PAMP = 47;
export const METR = 54;
export const ARS = 66;

export interface OrderRow {
  id: number;
  userid: number;
  instrumentid: number;
  side: string;
  type: string;
  status: string;
  size: number;
  price: string;
  clientorderid: string | null;
}

export function orderHelpers(ctx: () => TestApp) {
  const post = (body: unknown, key: string = randomUUID()) =>
    request(ctx().app)
      .post('/orders')
      .set('Idempotency-Key', key)
      .send(body as object);

  const countOrders = async () => {
    const { rows } = await ctx().pool.query<{ count: string }>('SELECT count(*) FROM orders');
    return Number(rows[0]?.count);
  };

  const orderRow = async (id: number) => {
    const { rows } = await ctx().pool.query<OrderRow>('SELECT * FROM orders WHERE id = $1', [id]);
    return rows[0];
  };

  /** A fresh user, optionally funded with a CASH_IN, so tests do not share balances. */
  const newUser = async (cash?: string) => {
    const { rows } = await ctx().pool.query<{ id: number }>(
      `INSERT INTO users (email, accountnumber) VALUES ($1, $2) RETURNING id`,
      [`${randomUUID()}@test.com`, randomUUID().slice(0, 20)],
    );
    const userId = rows[0]!.id;
    if (cash !== undefined) {
      const res = await post({ userId, side: 'CASH_IN', amount: cash });
      if (res.status !== 201) throw new Error(`CASH_IN failed: ${JSON.stringify(res.body)}`);
    }
    return userId;
  };

  const shares = async (userId: number, instrumentId: number) => {
    const { rows } = await ctx().pool.query<{ shares: string }>(
      `SELECT COALESCE(SUM(CASE WHEN side = 'BUY' THEN size ELSE -size END), 0) AS shares
         FROM orders
        WHERE userid = $1 AND instrumentid = $2 AND status = 'FILLED' AND side IN ('BUY', 'SELL')`,
      [userId, instrumentId],
    );
    return Number(rows[0]?.shares);
  };

  return { post, countOrders, orderRow, newUser, shares };
}
