import type { Money } from '../../../platform/money.ts';

export const ORDER_SIDES = ['BUY', 'SELL', 'CASH_IN', 'CASH_OUT'] as const;
export const ORDER_TYPES = ['MARKET', 'LIMIT'] as const;

export type OrderSide = (typeof ORDER_SIDES)[number];
export type OrderType = (typeof ORDER_TYPES)[number];
export type OrderStatus = 'NEW' | 'FILLED' | 'REJECTED' | 'CANCELLED';
export type TransferSide = 'CASH_IN' | 'CASH_OUT';
export type ShareSide = Exclude<OrderSide, TransferSide>;

/**
 * What `orders.size` means depends on the side: whole shares for BUY and SELL, pesos with up to
 * two decimals for CASH_IN and CASH_OUT (always at price 1).
 */
export type SizedSide = { side: ShareSide; size: number } | { side: TransferSide; size: Money };

export type Order = {
  id: number;
  userId: number;
  instrumentId: number;
  type: OrderType;
  status: OrderStatus;
  price: Money;
  datetime: Date;
} & SizedSide;

/**
 * Largest size accepted, in shares or in pesos. `orders.size` is NUMERIC(20, 2); this lower
 * bound keeps share counts exact as JavaScript numbers and balance sums far from overflow.
 */
export const MAX_ORDER_SIZE = 2_147_483_647;

/** CASH_IN and CASH_OUT move pesos on the ARS instrument at price 1. */
export function isTransfer(side: OrderSide): side is TransferSide {
  return side === 'CASH_IN' || side === 'CASH_OUT';
}

/** Same side and the exact same size (cents included for transfers). */
export function sameSize(a: SizedSide, b: SizedSide): boolean {
  if (typeof a.size === 'number' || typeof b.size === 'number') return a.size === b.size;
  return a.size.cents === b.size.cents;
}

/** JSON form of `size`: an integer for shares, a decimal string with two places for pesos. */
export function sizeToJson(order: SizedSide): number | string {
  return typeof order.size === 'number' ? order.size : order.size.toString();
}

/** Status an order is stored with: only missing funds or holdings reject it. */
export function initialStatus(type: OrderType, hasFunds: boolean): OrderStatus {
  if (!hasFunds) return 'REJECTED';
  return type === 'LIMIT' ? 'NEW' : 'FILLED';
}
