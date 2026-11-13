import { describe, expect, it } from 'vitest';
import {
  valuePortfolio,
  type Holding,
} from '../../src/modules/portfolio/domain/position-valuation.ts';
import { Money } from '../../src/platform/money.ts';

const holding = (overrides: Partial<Holding> = {}): Holding => ({
  instrumentId: 1,
  ticker: 'AAA',
  name: 'Alpha',
  quantity: 10,
  buySize: 10,
  buyCost: Money.parse('1000.00'),
  ...overrides,
});

const quote = (close: string, previousClose: string) => ({
  close,
  previousClose,
  date: '2023-07-14',
});

function onlyPosition(input: Parameters<typeof valuePortfolio>[0]) {
  const { positions } = valuePortfolio(input);
  expect(positions).toHaveLength(1);
  return positions[0] as (typeof positions)[number];
}

describe('valuePortfolio', () => {
  it('values a position and adds it to the full cash balance', () => {
    const result = valuePortfolio({
      cashBalance: Money.parse('500.00'),
      reservedCash: Money.parse('200.00'),
      holdings: [holding()],
      quotes: new Map([[1, quote('110.00', '100.00')]]),
    });

    expect(result).toEqual({
      totalAccountValue: '1600.00',
      availableCash: '300.00',
      cashBalance: '500.00',
      reservedCash: '200.00',
      positions: [
        {
          instrumentId: 1,
          ticker: 'AAA',
          name: 'Alpha',
          quantity: 10,
          averageCost: '100.00',
          lastPrice: '110.00',
          marketValue: '1100.00',
          totalReturnPct: '10.00',
          dailyReturnPct: '10.00',
        },
      ],
    });
  });

  it('keeps the average cost of all buys after a sell', () => {
    // Bought 10 at 100 and sold 4: average cost stays 100.
    const position = onlyPosition({
      cashBalance: Money.zero,
      reservedCash: Money.zero,
      holdings: [holding({ quantity: 6 })],
      quotes: new Map([[1, quote('100.00', '100.00')]]),
    });

    expect(position).toMatchObject({ quantity: 6, averageCost: '100.00', marketValue: '600.00' });
  });

  it('rounds half up to two decimals and computes the return from exact totals', () => {
    // 3 units for 100.00: average 33.333... → 33.33. Close 33.34:
    // exact return (33.34 × 3 − 100) / 100 = 0.02% (from the rounded average it would be 0.03%).
    const position = onlyPosition({
      cashBalance: Money.zero,
      reservedCash: Money.zero,
      holdings: [holding({ quantity: 3, buySize: 3, buyCost: Money.parse('100.00') })],
      quotes: new Map([[1, quote('33.34', '33.33')]]),
    });

    expect(position.averageCost).toBe('33.33');
    expect(position.totalReturnPct).toBe('0.02');
    // (33.34 − 33.33) / 33.33 = 0.030003% → 0.03
    expect(position.dailyReturnPct).toBe('0.03');
  });

  it('rounds an exact half away from zero', () => {
    // 2 units for 0.05 → average 0.025 → 0.03; close 0.02 → (0.04 − 0.05) / 0.05 = −20.00%.
    const position = onlyPosition({
      cashBalance: Money.zero,
      reservedCash: Money.zero,
      holdings: [holding({ quantity: 2, buySize: 2, buyCost: Money.parse('0.05') })],
      quotes: new Map([[1, quote('0.02', '0.08')]]),
    });

    expect(position.averageCost).toBe('0.03');
    expect(position.totalReturnPct).toBe('-20.00');
    expect(position.dailyReturnPct).toBe('-75.00');
  });

  it('drops positions with quantity zero or below', () => {
    const result = valuePortfolio({
      cashBalance: Money.parse('10.00'),
      reservedCash: Money.zero,
      holdings: [holding({ quantity: 0 }), holding({ instrumentId: 2, quantity: -10 })],
      quotes: new Map([
        [1, quote('5.00', '5.00')],
        [2, quote('5.00', '5.00')],
      ]),
    });

    expect(result.positions).toEqual([]);
    expect(result.totalAccountValue).toBe('10.00');
  });

  it('lists a position without market data with null prices and adds nothing to the total', () => {
    const result = valuePortfolio({
      cashBalance: Money.parse('10.00'),
      reservedCash: Money.zero,
      holdings: [holding()],
      quotes: new Map(),
    });

    expect(result.positions).toEqual([
      {
        instrumentId: 1,
        ticker: 'AAA',
        name: 'Alpha',
        quantity: 10,
        averageCost: '100.00',
        lastPrice: null,
        marketValue: null,
        totalReturnPct: null,
        dailyReturnPct: null,
      },
    ]);
    expect(result.totalAccountValue).toBe('10.00');
  });

  it('orders positions by ticker', () => {
    const result = valuePortfolio({
      cashBalance: Money.zero,
      reservedCash: Money.zero,
      holdings: [
        holding({ instrumentId: 1, ticker: 'ZZZ' }),
        holding({ instrumentId: 2, ticker: 'BBB' }),
      ],
      quotes: new Map(),
    });

    expect(result.positions.map((p) => p.ticker)).toEqual(['BBB', 'ZZZ']);
  });
});
