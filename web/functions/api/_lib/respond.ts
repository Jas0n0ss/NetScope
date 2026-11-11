/** CORS, cache and security headers plus JSON/text response helpers. */

import { ApiError } from './errors';

function corsOrigin(request: Request, env: Env): { origin: string; vary: boolean } | null {
  const configured = (env.CORS_ORIGINS ?? '*').trim() || '*';
  if (configured === '*') return { origin: '*', vary: false };
  const requestOrigin = request.headers.get('origin') ?? '';
  if (!requestOrigin) return null;
  const allowed = configured
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (allowed.includes(requestOrigin)) return { origin: requestOrigin, vary: true };
  return null;
}

function applyHeaders(headers: Headers, request: Request, env: Env): void {
  const cors = corsOrigin(request, env);
  if (cors) {
    headers.set('access-control-allow-origin', cors.origin);
    if (cors.vary) headers.set('vary', 'Origin');
  }
  headers.set('access-control-allow-methods', 'GET, OPTIONS');
  headers.set('access-control-allow-headers', 'Accept, Content-Type');
  headers.set('access-control-max-age', '600');
  headers.set('cache-control', 'no-store');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'strict-origin-when-cross-origin');
}

export function jsonResponse(
  payload: unknown,
  status: number,
  request: Request,
  env: Env,
  extra: Record<string, string> = {},
): Response {
  const headers = new Headers();
  applyHeaders(headers, request, env);
  headers.set('content-type', 'application/json; charset=utf-8');
  for (const [key, value] of Object.entries(extra)) headers.set(key, value);
  return new Response(JSON.stringify(payload), { status, headers });
}

export function textResponse(
  body: string,
  status: number,
  request: Request,
  env: Env,
  contentType = 'text/plain; charset=utf-8',
): Response {
  const headers = new Headers();
  applyHeaders(headers, request, env);
  headers.set('content-type', contentType);
  return new Response(body, { status, headers });
}

export function errorResponse(error: ApiError, request: Request, env: Env): Response {
  const extra: Record<string, string> = error.status === 429 ? { 'retry-after': '60' } : {};
  return jsonResponse(
    {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        hint: error.hint,
      },
    },
    error.status,
    request,
    env,
    extra,
  );
}

export function preflightResponse(request: Request, env: Env): Response {
  const headers = new Headers();
  applyHeaders(headers, request, env);
  return new Response(null, { status: 204, headers });
}

export function methodNotAllowed(request: Request, env: Env): Response {
  const response = errorResponse(
    new ApiError('method_not_allowed', 'The method is not allowed for the requested URL.', 405),
    request,
    env,
  );
  response.headers.set('allow', 'GET, OPTIONS');
  return response;
}
