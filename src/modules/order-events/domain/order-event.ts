export type OrderEventType = 'order.created' | 'order.cancelled';

/** Payload published to SNS and stored by the consumer in analytics.order_events. */
export interface OrderEvent {
  /** Unique per event; the consumer uses it to ignore redeliveries (D-18). */
  eventId: string;
  type: OrderEventType;
  occurredAt: string;
  order: {
    id: number;
    userId: number;
    instrumentId: number;
    side: string;
    type: string;
    status: string;
    /** Integer shares for BUY/SELL; pesos as a decimal string with two places for transfers. */
    size: number | string;
    price: string;
  };
}
