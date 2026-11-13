import type { Money } from '../../shared/domain/money.ts';
import type { Holding } from '../domain/position-valuation.ts';

export interface CashSummary {
  /** CASH_IN + SELL − CASH_OUT − BUY over FILLED orders. */
  balance: Money;
  /** size × price of NEW LIMIT BUY orders. */
  reserved: Money;
}

/** Read side of a user's account, aggregated from the orders table. */
export interface AccountReader {
  userExists(userId: number): Promise<boolean>;
  getCash(userId: number): Promise<CashSummary>;
  /** One entry per instrument with FILLED BUY/SELL orders, cash instruments excluded. */
  getHoldings(userId: number): Promise<Holding[]>;
}
