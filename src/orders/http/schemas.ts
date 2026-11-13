import { z } from 'zod';
import { Money } from '../../shared/domain/money.ts';
import { isTransfer, MAX_ORDER_SIZE, ORDER_SIDES, ORDER_TYPES } from '../domain/order.ts';

/** Largest value of a NUMERIC(10, 2) column, in cents. */
const MAX_PRICE_CENTS = 9_999_999_999n;
const MAX_SIZE_CENTS = BigInt(MAX_ORDER_SIZE) * 100n;
const MAX_ID = 2_147_483_647;
const DECIMAL = /^\d+(\.\d{1,2})?$/;

/** Positive decimal with up to 2 places, sent as a string or a number; parsed exactly via string. */
const decimal = z
  .union([z.string(), z.number()])
  .transform((value) => String(value))
  .pipe(z.string().regex(DECIMAL, 'Expected a positive decimal with up to 2 places'))
  .transform((value) => Money.parse(value))
  .refine((money) => money.cents > 0n, 'Must be greater than 0')
  .refine((money) => money.cents <= MAX_PRICE_CENTS, 'Must be at most 99999999.99');

const id = z.number().int().positive().max(MAX_ID);

/** Pesos of a transfer size: positive, up to 2 decimals, at most MAX_ORDER_SIZE. */
function transferSize(value: number | string): Money | null {
  const text = String(value);
  if (!DECIMAL.test(text)) return null;
  const money = Money.parse(text);
  return money.cents > 0n && money.cents <= MAX_SIZE_CENTS ? money : null;
}

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
    amount: decimal.optional(),
    price: decimal.optional(),
  })
  .superRefine((body, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });

    if ((body.size === undefined) === (body.amount === undefined)) {
      issue('size', 'Send exactly one of size or amount');
    }
    if (isTransfer(body.side)) {
      if (body.size !== undefined && !transferSize(body.size)) {
        issue('size', `Expected pesos greater than 0, up to 2 decimals and ${MAX_ORDER_SIZE}`);
      }
      if (body.type === 'LIMIT') issue('type', 'Transfers are always MARKET');
      if (body.price !== undefined) issue('price', 'Transfers do not take a price');
      return;
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
  // Validated above: transfer sizes become pesos, share sizes stay integers.
  .transform(({ size, ...body }) => ({
    ...body,
    size:
      size === undefined
        ? undefined
        : isTransfer(body.side)
          ? (transferSize(size) as Money)
          : (shareSize(size) as number),
  }));
