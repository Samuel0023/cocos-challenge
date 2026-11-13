import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import type { Logger } from '../logger.ts';
import { AppError, notFound } from './errors.ts';

export const routeNotFound: RequestHandler = (_req, _res, next) => {
  next(notFound('Route not found'));
};

export function errorMiddleware(logger: Logger): ErrorRequestHandler {
  // Express identifies error handlers by their four parameters.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return (error, _req, res, _next) => {
    if (error instanceof ZodError) {
      res.status(400).json({
        error: { code: 'BAD_REQUEST', message: 'Invalid request', details: error.issues },
      });
      return;
    }
    if (error instanceof AppError) {
      res.status(error.status).json({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      });
      return;
    }
    // Malformed JSON bodies rejected by express.json().
    if (error instanceof SyntaxError && 'status' in error && error.status === 400) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Malformed JSON body' } });
      return;
    }
    logger.error({ err: error }, 'unhandled error');
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  };
}
