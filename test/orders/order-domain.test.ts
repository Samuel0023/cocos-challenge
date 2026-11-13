import { describe, expect, it } from 'vitest';
import { hasFundsFor } from '../../src/orders/domain/funds-policy.ts';
import { initialStatus, isTransfer } from '../../src/orders/domain/order.ts';
import { sizeFromAmount } from '../../src/orders/domain/order-sizing.ts';
import { Money } from '../../src/shared/domain/money.ts';

describe('initialStatus', () => {
  it('fills accepted MARKET orders and leaves accepted LIMIT orders NEW', () => {
    expect(initialStatus('MARKET', true)).toBe('FILLED');
    expect(initialStatus('LIMIT', true)).toBe('NEW');
  });

  it('rejects any order without funds or holdings', () => {
    expect(initialStatus('MARKET', false)).toBe('REJECTED');
    expect(initialStatus('LIMIT', false)).toBe('REJECTED');
  });
});

describe('isTransfer', () => {
  it('is true only for CASH_IN and CASH_OUT', () => {
    expect(isTransfer('CASH_IN')).toBe(true);
    expect(isTransfer('CASH_OUT')).toBe(true);
    expect(isTransfer('BUY')).toBe(false);
    expect(isTransfer('SELL')).toBe(false);
  });
});

describe('sizeFromAmount', () => {
  it('buys the whole number of shares the amount covers', () => {
    expect(sizeFromAmount(Money.parse('5000'), Money.parse('925.85'))).toBe(5);
    expect(sizeFromAmount(Money.parse('925.85'), Money.parse('925.85'))).toBe(1);
  });

  it('returns 0 when the amount does not reach one share', () => {
    expect(sizeFromAmount(Money.parse('925.84'), Money.parse('925.85'))).toBe(0);
  });

  it('truncates pesos for transfers priced at 1', () => {
    expect(sizeFromAmount(Money.parse('1500.75'), Money.parse('1'))).toBe(1500);
  });
});

describe('hasFundsFor', () => {
  const available = { cash: Money.parse('1000.00'), shares: 10 };

  it('accepts a BUY or CASH_OUT whose total equals the available cash', () => {
    expect(hasFundsFor({ side: 'BUY', size: 4, price: Money.parse('250') }, available)).toBe(true);
    expect(hasFundsFor({ side: 'CASH_OUT', size: 1000, price: Money.parse('1') }, available)).toBe(
      true,
    );
  });

  it('rejects a BUY or CASH_OUT above the available cash by one cent', () => {
    expect(hasFundsFor({ side: 'BUY', size: 1, price: Money.parse('1000.01') }, available)).toBe(
      false,
    );
    expect(hasFundsFor({ side: 'CASH_OUT', size: 1001, price: Money.parse('1') }, available)).toBe(
      false,
    );
  });

  it('accepts a SELL up to the available shares and rejects one more', () => {
    expect(hasFundsFor({ side: 'SELL', size: 10, price: Money.parse('1') }, available)).toBe(true);
    expect(hasFundsFor({ side: 'SELL', size: 11, price: Money.parse('1') }, available)).toBe(false);
  });

  it('always accepts CASH_IN', () => {
    const empty = { cash: Money.zero, shares: 0 };
    expect(hasFundsFor({ side: 'CASH_IN', size: 5, price: Money.parse('1') }, empty)).toBe(true);
  });
});
