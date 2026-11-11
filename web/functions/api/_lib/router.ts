/** Router for every `/api/*` endpoint plus the plain-text `/ip` helper. */

import { ApiError } from './errors';
import { dnsLookup } from './dns';
import { enforceGeneral, enforceRate, limits } from './ratelimit';
import { inspectUrl } from './inspect';
import { publicIpPayload } from './ipinfo';
import { checkPort } from './port';
import { errorResponse, jsonResponse, methodNotAllowed, preflightResponse, textResponse } from './respond';
import { smtpLookup } from './smtp';
import { tlsInfo } from './tls';
import { resolvePublicHost } from './target';

export const APP_VERSION = '2.1.0';
export const FEATURES = ['inspect', 'tls', 'dns', 'smtp', 'port', 'ip'];

function parsePort(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const text = raw.trim();
  if (!/^[+-]?\d+$/.test(text)) {
    throw new ApiError('invalid_port', 'The port must be an integer.');
  }
  const value = Number(text);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new ApiError('invalid_port', 'The port must be between 1 and 65535.');
  }
  return value;
}

function pathOf(request: Request): string {
  const pathname = new URL(request.url).pathname;
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const query = url.searchParams;
  const path = pathOf(request);

  switch (path) {
    case '/api/health': {
      return jsonResponse(
        {
          ok: true,
          service: 'netscope',
          version: APP_VERSION,
          features: FEATURES,
          runtime: 'workers',
          time: new Date().toISOString(),
        },
        200,
        request,
        env,
      );
    }

    case '/api/features': {
      return jsonResponse({ ok: true, version: APP_VERSION, features: FEATURES }, 200, request, env);
    }

    case '/api/ip': {
      enforceGeneral(request, env, 'ip');
      return jsonResponse(await publicIpPayload(request), 200, request, env);
    }

    case '/api/inspect': {
      enforceGeneral(request, env, 'inspect-general');
      enforceRate(request, 'inspect', limits(env).inspect);
      const raw = (query.get('url') ?? '').trim();
      if (!raw) throw new ApiError('missing_url', 'Pass a url query parameter.');
      return jsonResponse(await inspectUrl(raw), 200, request, env);
    }

    case '/api/tls': {
      enforceGeneral(request, env, 'tls');
      const host = (query.get('host') ?? '').trim();
      if (!host) throw new ApiError('missing_host', 'Pass a host query parameter.');
      const port = parsePort(query.get('port'), 443);
      // Reject private/loopback targets before touching crt.sh.
      await resolvePublicHost(host, port);
      const details = await tlsInfo(host, port);
      return jsonResponse({ ok: true, host, port, tls: details }, 200, request, env);
    }

    case '/api/dns': {
      enforceGeneral(request, env, 'dns');
      const name = (query.get('name') ?? '').trim();
      if (!name) throw new ApiError('missing_name', 'Pass a name query parameter.');
      const typeParam = query.get('type');
      const qtype = (typeParam === null ? 'A' : typeParam).trim().toUpperCase();
      return jsonResponse(await dnsLookup(name, qtype), 200, request, env);
    }

    case '/api/port': {
      enforceGeneral(request, env, 'port-general');
      enforceRate(request, 'port', limits(env).port);
      const host = (query.get('host') ?? '').trim();
      if (!host) throw new ApiError('missing_host', 'Pass a host query parameter.');
      const port = parsePort(query.get('port'), 443);
      return jsonResponse(await checkPort(host, port), 200, request, env);
    }

    case '/api/smtp': {
      enforceGeneral(request, env, 'smtp-general');
      enforceRate(request, 'smtp', limits(env).smtp);
      const host = (query.get('host') ?? '').trim();
      if (!host) throw new ApiError('missing_host', 'Pass a host query parameter.');
      const port = parsePort(query.get('port'), 587);
      const mode = ((query.get('mode') ?? 'auto').trim().toLowerCase() || 'auto') as string;
      return jsonResponse(await smtpLookup(host, port, mode), 200, request, env);
    }

    default: {
      throw new ApiError('not_found', 'Endpoint not found.', 404);
    }
  }
}

export async function handleApi(context: EventContext<Env>): Promise<Response> {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return preflightResponse(request, env);
  if (request.method !== 'GET') return methodNotAllowed(request, env);

  try {
    return await route(request, env);
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error, request, env);
    console.error('NetScope API error:', error);
    return errorResponse(new ApiError('internal_error', 'Unexpected server error.'), request, env);
  }
}

export async function handlePlainIp(context: EventContext<Env>): Promise<Response> {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return preflightResponse(request, env);
  if (request.method !== 'GET') return methodNotAllowed(request, env);

  try {
    enforceGeneral(request, env, 'ip');
    const payload = await publicIpPayload(request);
    return textResponse(`${payload.ip}\n`, 200, request, env);
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error, request, env);
    console.error('NetScope /ip error:', error);
    return errorResponse(new ApiError('internal_error', 'Unexpected server error.'), request, env);
  }
}
