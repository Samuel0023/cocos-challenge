import { z } from 'zod';
import { Money } from '../../shared/domain/money.ts';
import { isTransfer, MAX_ORDER_SIZE, ORDER_SIDES, ORDER_TYPES } from '../domain/order.ts';

/** Largest value of a NUMERIC(10, 2) column, in cents. */
const MAX_PRICE_CENTS = 9_999_999_999n;
const MAX_ID = 2_147_483_647;

/** Positive decimal with up to 2 places, sent as a string or a number; parsed exactly via string. */
const decimal = z
  .union([z.string(), z.number()])
  .transform((value) => String(value))
  .pipe(z.string().regex(/^\d+(\.\d{1,2})?$/, 'Expected a positive decimal with up to 2 places'))
  .transform((value) => Money.parse(value))
  .refine((money) => money.cents > 0n, 'Must be greater than 0')
  .refine((money) => money.cents <= MAX_PRICE_CENTS, 'Must be at most 99999999.99');

const id = z.number().int().positive().max(MAX_ID);

export const submitOrderBody = z
  .object({
    userId: id,
    instrumentId: id.optional(),
    side: z.enum(ORDER_SIDES),
    type: z.enum(ORDER_TYPES).optional(),
    size: z.number().int().positive().max(MAX_ORDER_SIZE).optional(),
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
      if (body.type === 'LIMIT') issue('type', 'Transfers are always MARKET');
      if (body.price !== undefined) issue('price', 'Transfers do not take a price');
      return;
    }
    if (body.instrumentId === undefined) issue('instrumentId', 'Required for BUY and SELL');
    if (body.type === undefined) issue('type', 'Required for BUY and SELL');
    if (body.type === 'LIMIT' && body.price === undefined) issue('price', 'Required for LIMIT');
    if (body.type === 'MARKET' && body.price !== undefined) {
      issue('price', 'Not allowed for MARKET');
    }
  });
