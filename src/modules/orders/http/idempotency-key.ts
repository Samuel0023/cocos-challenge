import type { RequestHandler } from 'express';
import { badRequest } from '../../../platform/errors.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Requires an `Idempotency-Key` UUID header and exposes it as `res.locals.idempotencyKey`. */
export const requireIdempotencyKey: RequestHandler = (req, res, next) => {
  const key = req.get('Idempotency-Key');
  if (!key || !UUID.test(key)) {
    next(badRequest('Header Idempotency-Key is required and must be a UUID'));
    return;
  }
  res.locals.idempotencyKey = key.toLowerCase();
  next();
};
