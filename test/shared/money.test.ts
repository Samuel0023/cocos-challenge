import { describe, expect, it } from 'vitest';
import { Money } from '../../src/shared/domain/money.ts';

describe('Money', () => {
  it('parses and prints decimals with two places', () => {
    expect(Money.parse('925.85').toString()).toBe('925.85');
    expect(Money.parse('1').toString()).toBe('1.00');
    expect(Money.parse('0.5').toString()).toBe('0.50');
    expect(Money.parse('-10.05').toString()).toBe('-10.05');
  });

  it('rejects values that are not plain decimals with up to two places', () => {
    for (const value of ['', 'abc', '1.234', '1e3', '1,5']) {
      expect(() => Money.parse(value)).toThrow(RangeError);
    }
  });

  it('adds, subtracts, multiplies by a quantity and compares exactly', () => {
    const price = Money.parse('0.10');
    expect(price.times(3).toString()).toBe('0.30');
    expect(price.plus(Money.parse('0.20')).toString()).toBe('0.30');
    expect(price.minus(Money.parse('0.20')).toString()).toBe('-0.10');
    expect(price.greaterThan(Money.parse('0.09'))).toBe(true);
    expect(price.greaterThan(price)).toBe(false);
  });

  it('floors how many whole units an amount buys', () => {
    expect(Money.parse('10000').wholeUnitsAt(Money.parse('925.85'))).toBe(10);
    expect(Money.parse('925.84').wholeUnitsAt(Money.parse('925.85'))).toBe(0);
  });

  it('computes a percentage change rounded half up to two decimals', () => {
    expect(Money.parse('925.85').percentChangeFrom(Money.parse('921.80'))).toBe('0.44');
    expect(Money.parse('90').percentChangeFrom(Money.parse('100'))).toBe('-10.00');
    expect(Money.parse('1').percentChangeFrom(Money.parse('3'))).toBe('-66.67');
    expect(Money.parse('1').percentChangeFrom(Money.zero)).toBeNull();
  });
});
