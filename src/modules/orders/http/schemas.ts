import { z } from 'zod';
import { Money } from '../../../platform/money.ts';
import { isTransfer, MAX_ORDER_SIZE, ORDER_SIDES, ORDER_TYPES } from '../domain/order.ts';

/** Largest value of a NUMERIC(10, 2) column, in cents. */
const MAX_PRICE_CENTS = 9_999_999_999n;
/** Largest value of the NUMERIC(20, 2) `orders.size` column, in cents: the cap for a transfer. */
const MAX_TRANSFER_CENTS = 99_999_999_999_999_999_999n;
const MAX_ID = 2_147_483_647;
const DECIMAL = /^\d+(\.\d{1,2})?$/;

/** Positive decimal with up to 2 places, sent as a string or a number; parsed exactly via string. */
const decimalUpTo = (maxCents: bigint) =>
  z
    .union([z.string(), z.number()])
    .transform((value) => String(value))
    .pipe(z.string().regex(DECIMAL, 'Expected a positive decimal with up to 2 places'))
    .transform((value) => Money.parse(value))
    .refine((money) => money.cents > 0n, 'Must be greater than 0')
    .refine(
      (money) => money.cents <= maxCents,
      `Must be at most ${Money.fromCents(maxCents).toString()}`,
    );

const id = z.number().int().positive().max(MAX_ID);

/** Shares of a BUY/SELL size: a JSON integer from 1 to MAX_ORDER_SIZE. */
function shareSize(value: number | string): number | null {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= MAX_ORDER_SIZE
    ? value
    : null;
}

export const submitOrderBody = z
  .object({
    userId: id,
    instrumentId: id.optional(),
    side: z.enum(ORDER_SIDES),
    type: z.enum(ORDER_TYPES).optional(),
    size: z.union([z.number(), z.string()]).optional(),
    amount: decimalUpTo(MAX_TRANSFER_CENTS).optional(),
    price: decimalUpTo(MAX_PRICE_CENTS).optional(),
  })
  .superRefine((body, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });

    if (isTransfer(body.side)) {
      // A transfer has no shares to count: its pesos always travel in `amount`.
      if (body.size !== undefined) issue('size', 'Transfers take pesos in amount, not size');
      if (body.amount === undefined) issue('amount', 'Required for CASH_IN and CASH_OUT');
      if (body.type === 'LIMIT') issue('type', 'Transfers are always MARKET');
      if (body.price !== undefined) issue('price', 'Transfers do not take a price');
      return;
    }
    if ((body.size === undefined) === (body.amount === undefined)) {
      issue('size', 'Send exactly one of size or amount');
    }
    // Invested through `price`, so the amount is bound by that column.
    if (body.amount !== undefined && body.amount.cents > MAX_PRICE_CENTS) {
      issue('amount', 'Must be at most 99999999.99');
    }
    if (body.size !== undefined && shareSize(body.size) === null) {
      issue('size', `Expected a whole number of shares from 1 to ${MAX_ORDER_SIZE}`);
    }
    if (body.instrumentId === undefined) issue('instrumentId', 'Required for BUY and SELL');
    if (body.type === undefined) issue('type', 'Required for BUY and SELL');
    if (body.type === 'LIMIT' && body.price === undefined) issue('price', 'Required for LIMIT');
    if (body.type === 'MARKET' && body.price !== undefined) {
      issue('price', 'Not allowed for MARKET');
    }
  })
  // Validated above: a size is always a whole number of shares.
  .transform(({ size, ...body }) => ({
    ...body,
    size: size === undefined ? undefined : (shareSize(size) as number),
  }));
