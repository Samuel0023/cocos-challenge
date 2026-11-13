import type { Quote } from '../../marketdata/application/market-data-repository.ts';
import { Money } from '../../../platform/money.ts';

/** Net shares of one instrument from FILLED orders, with the totals of its FILLED buys. */
export interface Holding {
  instrumentId: number;
  ticker: string;
  name: string;
  quantity: number;
  buySize: number;
  buyCost: Money;
}

export interface PositionView {
  instrumentId: number;
  ticker: string;
  name: string;
  quantity: number;
  averageCost: string | null;
  lastPrice: string | null;
  marketValue: string | null;
  totalReturnPct: string | null;
  dailyReturnPct: string | null;
}

export interface PortfolioValuation {
  totalAccountValue: string;
  availableCash: string;
  cashBalance: string;
  reservedCash: string;
  positions: PositionView[];
}

export interface PortfolioInput {
  cashBalance: Money;
  reservedCash: Money;
  holdings: Holding[];
  quotes: Map<number, Pick<Quote, 'close' | 'previousClose'>>;
}

export function valuePortfolio(input: PortfolioInput): PortfolioValuation {
  let marketTotal = Money.zero;
  const positions = input.holdings
    .filter((holding) => holding.quantity > 0)
    .sort((a, b) => (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0))
    .map((holding) => {
      const quote = input.quotes.get(holding.instrumentId);
      const position = valuePosition(holding, quote);
      if (quote) marketTotal = marketTotal.plus(Money.parse(quote.close).times(holding.quantity));
      return position;
    });

  return {
    totalAccountValue: input.cashBalance.plus(marketTotal).toString(),
    availableCash: input.cashBalance.minus(input.reservedCash).toString(),
    cashBalance: input.cashBalance.toString(),
    reservedCash: input.reservedCash.toString(),
    positions,
  };
}

function valuePosition(
  holding: Holding,
  quote: Pick<Quote, 'close' | 'previousClose'> | undefined,
): PositionView {
  const hasBuys = holding.buySize > 0 && holding.buyCost.cents > 0n;
  const base = {
    instrumentId: holding.instrumentId,
    ticker: holding.ticker,
    name: holding.name,
    quantity: holding.quantity,
    averageCost: hasBuys
      ? formatHundredths(roundedDiv(holding.buyCost.cents, BigInt(holding.buySize)))
      : null,
  };
  if (!quote) {
    return {
      ...base,
      lastPrice: null,
      marketValue: null,
      totalReturnPct: null,
      dailyReturnPct: null,
    };
  }

  const close = Money.parse(quote.close);
  // Return from the exact totals: the average cost may not be a whole number of cents.
  const totalReturnPct = hasBuys
    ? formatHundredths(
        roundedDiv(
          (close.times(holding.buySize).cents - holding.buyCost.cents) * 10_000n,
          holding.buyCost.cents,
        ),
      )
    : null;

  return {
    ...base,
    lastPrice: close.toString(),
    marketValue: close.times(holding.quantity).toString(),
    totalReturnPct,
    dailyReturnPct: close.percentChangeFrom(Money.parse(quote.previousClose)),
  };
}

/** Integer division rounded half away from zero. */
function roundedDiv(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const quotient = (n * 2n + d) / (d * 2n);
  return negative ? -quotient : quotient;
}

/** Hundredths as a decimal string with two places, e.g. -45n → "-0.45". */
function formatHundredths(value: bigint): string {
  return Money.fromCents(value).toString();
}
