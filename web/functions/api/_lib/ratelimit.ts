/**
 * Per-isolate sliding-window rate limiter.
 *
 * CAVEAT: the counters live in module scope, so every Cloudflare isolate keeps
 * its own Map. Limits are best effort, not globally consistent. Use a Durable
 * Object or the Workers Rate Limiting binding if you need a global quota.
 */

import { rateLimited } from './errors';
import { clientIp } from './ipinfo';

const WINDOW_MS = 60_000;
const MAX_KEYS = 4096;
const hits = new Map<string, number[]>();

function limitFromEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface Limits {
  general: number;
  inspect: number;
  port: number;
  smtp: number;
}

export function limits(env: Env): Limits {
  return {
    general: limitFromEnv(env.RATE_LIMIT_GENERAL, 120),
    inspect: limitFromEnv(env.RATE_LIMIT_INSPECT, 12),
    port: limitFromEnv(env.RATE_LIMIT_PORT, 12),
    smtp: limitFromEnv(env.RATE_LIMIT_SMTP, 15),
  };
}

export function enforceRate(request: Request, bucket: string, limit: number): void {
  const key = `${bucket}:${clientIp(request)}`;
  const now = Date.now();
  let bucketHits = hits.get(key);
  if (!bucketHits) {
    bucketHits = [];
    hits.set(key, bucketHits);
  }
  while (bucketHits.length > 0 && now - bucketHits[0] > WINDOW_MS) {
    bucketHits.shift();
  }
  if (bucketHits.length >= limit) {
    throw rateLimited();
  }
  bucketHits.push(now);

  if (hits.size > MAX_KEYS) {
    for (const [candidate, values] of hits) {
      if (values.length === 0 || now - values[values.length - 1] > WINDOW_MS * 2) {
        hits.delete(candidate);
      }
    }
  }
}

export function enforceGeneral(request: Request, env: Env, bucket: string): void {
  enforceRate(request, bucket, limits(env).general);
}
