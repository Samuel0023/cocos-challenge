import type { Money } from '../../shared/domain/money.ts';

export const ORDER_SIDES = ['BUY', 'SELL', 'CASH_IN', 'CASH_OUT'] as const;
export const ORDER_TYPES = ['MARKET', 'LIMIT'] as const;

export type OrderSide = (typeof ORDER_SIDES)[number];
export type OrderType = (typeof ORDER_TYPES)[number];
export type OrderStatus = 'NEW' | 'FILLED' | 'REJECTED' | 'CANCELLED';

export interface Order {
  id: number;
  userId: number;
  instrumentId: number;
  side: OrderSide;
  type: OrderType;
  status: OrderStatus;
  size: number;
  price: Money;
  datetime: Date;
}

/** Largest value the INT `orders.size` column holds. */
export const MAX_ORDER_SIZE = 2_147_483_647;

/** CASH_IN and CASH_OUT move pesos on the ARS instrument at price 1. */
export function isTransfer(side: OrderSide): boolean {
  return side === 'CASH_IN' || side === 'CASH_OUT';
}

/** Status an order is stored with: only missing funds or holdings reject it. */
export function initialStatus(type: OrderType, hasFunds: boolean): OrderStatus {
  if (!hasFunds) return 'REJECTED';
  return type === 'LIMIT' ? 'NEW' : 'FILLED';
}
