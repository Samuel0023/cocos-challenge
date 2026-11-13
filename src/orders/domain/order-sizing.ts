import type { Money } from '../../shared/domain/money.ts';

/** Whole shares an amount covers at `price`; 0 when it does not reach one. */
export function sizeFromAmount(amount: Money, price: Money): number {
  return amount.wholeUnitsAt(price);
}
