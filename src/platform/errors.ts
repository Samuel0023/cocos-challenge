/** What went wrong, in terms a use case can state without knowing about HTTP. */
export type ErrorCode =
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNPROCESSABLE_ENTITY'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE';

/**
 * An expected failure with a code. The HTTP error middleware maps the code to a status;
 * anything else thrown becomes a 500.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError('BAD_REQUEST', message, details);
export const notFound = (message: string) => new AppError('NOT_FOUND', message);
export const conflict = (message: string) => new AppError('CONFLICT', message);
export const unprocessable = (message: string) => new AppError('UNPROCESSABLE_ENTITY', message);
export const payloadTooLarge = (message: string) => new AppError('PAYLOAD_TOO_LARGE', message);
export const unsupportedMediaType = (message: string) =>
  new AppError('UNSUPPORTED_MEDIA_TYPE', message);
