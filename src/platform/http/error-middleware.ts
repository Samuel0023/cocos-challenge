import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import type { Logger } from '../logger.ts';
import {
  AppError,
  badRequest,
  notFound,
  payloadTooLarge,
  unsupportedMediaType,
  type ErrorCode,
} from '../errors.ts';

/** The only place that knows which HTTP status an error code answers with. */
const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
};

export const routeNotFound: RequestHandler = (_req, _res, next) => {
  next(notFound('Route not found'));
};

/** The error `express.json()` raised for a body it refused to read, or null for any other error. */
function bodyParserError(error: unknown): AppError | null {
  if (!(error instanceof Error) || !('status' in error)) return null;
  // Only body-parser errors carry a `type` such as `entity.too.large`.
  if (!('type' in error) || typeof error.type !== 'string') return null;
  if (error.status === 413) return payloadTooLarge('Request body is too large');
  if (error.status === 415) return unsupportedMediaType('Unsupported request body encoding');
  if (error.status === 400) return badRequest('Malformed JSON body');
  return null;
}

export function errorMiddleware(logger: Logger): ErrorRequestHandler {
  // Express identifies error handlers by their four parameters.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return (thrown, _req, res, _next) => {
    if (thrown instanceof ZodError) {
      res.status(400).json({
        error: { code: 'BAD_REQUEST', message: 'Invalid request', details: thrown.issues },
      });
      return;
    }
    const error = thrown instanceof AppError ? thrown : bodyParserError(thrown);
    if (error) {
      res.status(STATUS[error.code]).json({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      });
      return;
    }
    logger.error({ err: thrown }, 'unhandled error');
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  };
}
