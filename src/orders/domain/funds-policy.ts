import type { Money } from '../../shared/domain/money.ts';
import type { OrderSide } from './order.ts';

export interface Availability {
  /** Cash balance minus the cash reserved by NEW LIMIT BUYs. */
  cash: Money;
  /** Shares held of the order's instrument minus those reserved by NEW LIMIT SELLs. */
  shares: number;
}

export interface FundsRequest {
  side: OrderSide;
  size: number;
  price: Money;
}

export function hasFundsFor(order: FundsRequest, available: Availability): boolean {
  switch (order.side) {
    case 'BUY':
    case 'CASH_OUT':
      return !order.price.times(order.size).greaterThan(available.cash);
    case 'SELL':
      return order.size <= available.shares;
    case 'CASH_IN':
      return true;
  }
}
