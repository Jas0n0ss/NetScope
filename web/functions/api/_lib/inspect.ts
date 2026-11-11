/**
 * Website inspector: manual redirect following, header capture and metadata
 * extraction. Mirrors `inspect_url` in pyapp/app.py with a smaller body cap
 * (512 KB) and a hard wall-clock budget so the request stays under 30 s.
 */

import { ApiError } from './errors';
import { concatBytes, isTimeoutError } from './util';
import { validatePublicUrl, resolvePublicHost, MAX_REDIRECTS } from './target';
import { extractMetadata } from './meta';
import { tlsInfo, type TlsResult } from './tls';

const USER_AGENT = 'NetScope/2.1 (+https://github.com/Jas0n0ss/lsp)';
const MAX_BODY_BYTES = 512 * 1024;
const HOP_TIMEOUT_MS = 12000;
const HTTP_BUDGET_MS = 18000;
const OVERALL_BUDGET_MS = 28000;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const REASON_PHRASES: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  206: 'Partial Content',
  301: 'Moved Permanently',
  302: 'Found',
  303: 'See Other',
  304: 'Not Modified',
  307: 'Temporary Redirect',
  308: 'Permanent Redirect',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  410: 'Gone',
  418: "I'm a teapot",
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

export interface RedirectStep {
  url: string;
  status: number;
  location: string;
  elapsed_ms: number;
}

function reasonPhrase(status: number): string {
  return REASON_PHRASES[status] ?? '';
}

function errorLabel(error: unknown): string {
  if (error instanceof Error && error.name) return error.name;
  return 'Error';
}

function charsetFromContentType(contentType: string): string {
  const match = /charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType);
  return match ? match[1] : 'utf-8';
}

function decodeBody(body: Uint8Array, contentType: string): string {
  let label = charsetFromContentType(contentType);
  try {
    return new TextDecoder(label, { fatal: false }).decode(body);
  } catch {
    label = 'utf-8';
    return new TextDecoder(label, { fatal: false }).decode(body);
  }
}

function safeHeaders(headers: Headers): Record<string, string> {
  const output: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') {
      output[key] = '[redacted]';
    } else {
      output[key] = String(value).slice(0, 4096);
    }
  });
  return output;
}

interface BodyRead {
  body: Uint8Array;
  size: number;
  truncated: boolean;
}

async function readBody(response: Response): Promise<BodyRead> {
  if (!response.body) return { body: new Uint8Array(0), size: 0, truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      const remaining = MAX_BODY_BYTES - size;
      if (remaining <= 0) {
        truncated = true;
        break;
      }
      if (value.byteLength >= remaining) {
        chunks.push(value.subarray(0, remaining));
        size += remaining;
        truncated = true;
        break;
      }
      chunks.push(value);
      size += value.byteLength;
    }
  } catch {
    truncated = true;
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* already closed */
    }
  }
  return { body: concatBytes(chunks), size, truncated };
}

function looksLikeHtml(body: Uint8Array): boolean {
  for (const byte of body) {
    if (byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d) continue;
    return byte === 0x3c; // "<"
  }
  return false;
}

export async function inspectUrl(rawUrl: string): Promise<Record<string, unknown>> {
  const requested = rawUrl.trim();
  let current = await validatePublicUrl(requested);
  const redirects: RedirectStep[] = [];
  const started = Date.now();
  const httpDeadline = started + HTTP_BUDGET_MS;
  const overallDeadline = started + OVERALL_BUDGET_MS;

  for (let attempt = 0; attempt <= MAX_REDIRECTS; attempt += 1) {
    const stepStarted = Date.now();
    const remaining = httpDeadline - stepStarted;
    if (remaining <= 0) {
      throw new ApiError('upstream_timeout', 'The request took too long to complete.', 504);
    }

    let response: Response;
    try {
      response = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(Math.min(HOP_TIMEOUT_MS, remaining)),
      });
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new ApiError('upstream_timeout', 'The upstream server took too long to respond.', 504);
      }
      throw new ApiError('upstream_error', `The site could not be reached: ${errorLabel(error)}.`, 502);
    }

    const stepElapsed = Date.now() - stepStarted;
    const status = response.status;
    const location = response.headers.get('location') ?? '';

    if (REDIRECT_STATUSES.has(status)) {
      try {
        await response.body?.cancel();
      } catch {
        /* ignore */
      }
      if (!location) break;
      if (attempt >= MAX_REDIRECTS) {
        throw new ApiError('too_many_redirects', `More than ${MAX_REDIRECTS} redirects were returned.`, 422);
      }
      let nextRaw: string;
      try {
        nextRaw = new URL(location, current).href;
      } catch {
        throw new ApiError('invalid_url', 'The redirect target could not be parsed.', 422);
      }
      const nextUrl = await validatePublicUrl(nextRaw);
      redirects.push({ url: current, status, location: nextUrl, elapsed_ms: stepElapsed });
      current = nextUrl;
      continue;
    }

    const read = await readBody(response);
    const contentType = response.headers.get('content-type') ?? '';
    const isHtml = contentType.toLowerCase().includes('html') || looksLikeHtml(read.body);
    const text = isHtml ? decodeBody(read.body, contentType) : '';
    const meta = extractMetadata(text, current);

    const parsed = new URL(current);
    const hostname = parsed.hostname.replace(/^\[/, '').replace(/\]$/, '');
    const targetPort = parsed.port ? Number(parsed.port) : 443;

    let ip = '';
    try {
      const budget = Math.max(500, Math.min(3000, overallDeadline - Date.now()));
      const resolved = await resolvePublicHost(hostname, targetPort, budget);
      ip = resolved.addresses[0] ?? '';
    } catch {
      ip = '';
    }

    const https = parsed.protocol === 'https:';
    let tls: TlsResult | null = null;
    if (https) {
      const remainingBudget = overallDeadline - Date.now();
      if (remainingBudget < 1500) {
        tls = { error: 'Certificate details are unavailable: the inspection timed out before the TLS lookup.' };
      } else {
        const timeoutMs = Math.min(9000, Math.max(1000, remainingBudget - 1000));
        const withFingerprint = remainingBudget > 9000;
        tls = await tlsInfo(hostname, targetPort, {
          timeoutMs,
          fingerprint: withFingerprint,
          fingerprintTimeoutMs: Math.min(4000, Math.max(800, remainingBudget - timeoutMs - 500)),
        });
      }
    }

    return {
      ok: true,
      requested_url: requested,
      final_url: current,
      status,
      reason: response.statusText || reasonPhrase(status),
      elapsed_ms: Date.now() - started,
      redirects,
      headers: safeHeaders(response.headers),
      content_type: contentType,
      body_bytes: read.size,
      truncated: read.truncated,
      https,
      tls,
      meta,
      ip,
      fetched_at: new Date().toISOString(),
    };
  }

  throw new ApiError('too_many_redirects', 'The redirect chain could not be completed.', 422);
}
