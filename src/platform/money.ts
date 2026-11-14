const DECIMAL = /^-?\d+(\.\d{1,2})?$/;

/**
 * Amount in pesos stored as an integer number of cents, so arithmetic is exact.
 * The database uses NUMERIC(10, 2) and the API exchanges decimal strings.
 */
export class Money {
  static readonly zero = new Money(0n);

  readonly cents: bigint;

  private constructor(cents: bigint) {
    this.cents = cents;
  }

  static parse(value: string): Money {
    if (!DECIMAL.test(value)) throw new RangeError(`Invalid amount: "${value}"`);
    const negative = value.startsWith('-');
    const [whole = '0', fraction = ''] = value.replace('-', '').split('.');
    const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
    return new Money(negative ? -cents : cents);
  }

  static fromCents(cents: bigint): Money {
    return new Money(cents);
  }

  plus(other: Money): Money {
    return new Money(this.cents + other.cents);
  }

  minus(other: Money): Money {
    return new Money(this.cents - other.cents);
  }

  times(quantity: number): Money {
    return new Money(this.cents * BigInt(quantity));
  }

  greaterThan(other: Money): boolean {
    return this.cents > other.cents;
  }

  /**
   * How many whole units this amount buys at `price` (order by amount, D-06), rounded down.
   * Throws a RangeError when `price` is zero or below: there is no unit count at such a price,
   * so callers must refuse that price first.
   */
  wholeUnitsAt(price: Money): number {
    if (price.cents <= 0n) {
      throw new RangeError(`Price must be greater than zero, got ${price.toString()}`);
    }
    return Number(this.cents / price.cents);
  }

  /** (this − base) / base × 100, rounded half up to two decimals; null when base is zero. */
  percentChangeFrom(base: Money): string | null {
    if (base.cents === 0n) return null;
    return formatHundredths(roundedDiv((this.cents - base.cents) * 10_000n, base.cents));
  }

  toString(): string {
    return formatHundredths(this.cents);
  }
}

/** Integer division rounded half away from zero. */
function roundedDiv(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const quotient = (n * 2n + d) / (d * 2n);
  return negative ? -quotient : quotient;
}

function formatHundredths(value: bigint): string {
  const abs = value < 0n ? -value : value;
  const text = `${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
  return value < 0n ? `-${text}` : text;
}
