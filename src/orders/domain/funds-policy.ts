import type { Money } from '../../shared/domain/money.ts';
import type { SizedSide } from './order.ts';

export interface Availability {
  /** Cash balance minus the cash reserved by NEW LIMIT BUYs. */
  cash: Money;
  /** Shares held of the order's instrument minus those reserved by NEW LIMIT SELLs. */
  shares: number;
}

export type FundsRequest = SizedSide & { price: Money };

export function hasFundsFor(order: FundsRequest, available: Availability): boolean {
  switch (order.side) {
    case 'BUY':
      return !order.price.times(order.size).greaterThan(available.cash);
    case 'CASH_OUT':
      // Transfers are priced at 1: the size is the amount of pesos, cents included.
      return !order.size.greaterThan(available.cash);
    case 'SELL':
      return order.size <= available.shares;
    case 'CASH_IN':
      return true;
  }
}
