/**
 * Error type shared by the NetScope API handlers.
 *
 * The JSON envelope mirrors the Flask implementation:
 *   { ok: false, error: { code, message, hint } }
 */

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly hint: string;

  constructor(code: string, message: string, status = 400, hint = '') {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.hint = hint;
  }
}

export function blockedHost(message = 'That hostname is not allowed.', hint = ''): ApiError {
  return new ApiError('blocked_host', message, 403, hint);
}

export function rateLimited(): ApiError {
  return new ApiError(
    'rate_limited',
    'Too many requests. Please wait a minute and try again.',
    429,
    'Rate limits are per client IP and reset on a sliding window.',
  );
}
