import type { OrderEvent } from '../shared/events/order-event.ts';
import type { Queryable } from '../shared/infra/postgres/db.ts';
import type { OrderEventStore } from './order-event-store.ts';

export class PgOrderEventStore implements OrderEventStore {
  private readonly db: Queryable;

  constructor(db: Queryable) {
    this.db = db;
  }

  async save(event: OrderEvent): Promise<void> {
    await this.db.query(
      `INSERT INTO analytics.order_events (event_id, event_type, order_id, user_id, payload, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (event_id) DO NOTHING`,
      [
        event.eventId,
        event.type,
        event.order.id,
        event.order.userId,
        JSON.stringify(event),
        event.occurredAt,
      ],
    );
  }
}
