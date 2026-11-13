import type { Money } from '../../shared/domain/money.ts';

/** Whole shares (or pesos, at price 1) an amount covers; 0 when it does not reach one. */
export function sizeFromAmount(amount: Money, price: Money): number {
  return amount.wholeUnitsAt(price);
}
