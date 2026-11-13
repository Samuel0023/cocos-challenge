import { Money } from '../../shared/domain/money.ts';
import type { Queryable } from '../../shared/infra/postgres/db.ts';
import type { Order, OrderSide, OrderStatus, OrderType } from '../domain/order.ts';
import {
  DuplicateClientOrderIdError,
  type NewOrder,
  type OrderRepository,
} from '../application/ports.ts';

interface Row {
  id: number;
  userid: number;
  instrumentid: number;
  side: OrderSide;
  type: OrderType;
  status: OrderStatus;
  size: number;
  price: string;
  datetime: Date;
}

const COLUMNS = 'id, userid, instrumentid, side, type, status, size, price, datetime';
const CLIENT_ORDER_ID_CONSTRAINT = 'orders_userid_clientorderid_key';

function toOrder(row: Row): Order {
  return {
    id: row.id,
    userId: row.userid,
    instrumentId: row.instrumentid,
    side: row.side,
    type: row.type,
    status: row.status,
    size: row.size,
    price: Money.parse(row.price),
    datetime: row.datetime,
  };
}

function isClientOrderIdViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505' &&
    'constraint' in error &&
    error.constraint === CLIENT_ORDER_ID_CONSTRAINT
  );
}

export class PgOrderRepository implements OrderRepository {
  private readonly db: Queryable;

  constructor(db: Queryable) {
    this.db = db;
  }

  async findById(id: number): Promise<Order | null> {
    const { rows } = await this.db.query<Row>(`SELECT ${COLUMNS} FROM orders WHERE id = $1`, [id]);
    return rows[0] ? toOrder(rows[0]) : null;
  }

  async findByClientOrderId(userId: number, clientOrderId: string): Promise<Order | null> {
    const { rows } = await this.db.query<Row>(
      `SELECT ${COLUMNS} FROM orders WHERE userid = $1 AND clientorderid = $2`,
      [userId, clientOrderId],
    );
    return rows[0] ? toOrder(rows[0]) : null;
  }

  async insert(order: NewOrder): Promise<Order> {
    try {
      const { rows } = await this.db.query<Row>(
        `INSERT INTO orders (userid, instrumentid, side, type, status, size, price, datetime, clientorderid)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING ${COLUMNS}`,
        [
          order.userId,
          order.instrumentId,
          order.side,
          order.type,
          order.status,
          order.size,
          order.price.toString(),
          order.datetime,
          order.clientOrderId,
        ],
      );
      return toOrder(rows[0]!);
    } catch (error) {
      if (isClientOrderIdViolation(error)) throw new DuplicateClientOrderIdError();
      throw error;
    }
  }

  async updateStatus(id: number, status: OrderStatus): Promise<Order> {
    const { rows } = await this.db.query<Row>(
      `UPDATE orders SET status = $2 WHERE id = $1 RETURNING ${COLUMNS}`,
      [id, status],
    );
    if (!rows[0]) throw new Error(`Order ${id} disappeared while updating its status`);
    return toOrder(rows[0]);
  }
}
