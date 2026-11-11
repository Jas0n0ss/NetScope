/**
 * DNS-over-HTTPS client used for SSRF pre-flight resolution and `/api/dns`.
 *
 * Cloudflare's resolver is tried first, Google's JSON API is the fallback.
 * Both speak the same JSON shape (Status / Answer / Authority).
 */

import { TimeoutError, errorMessage, isTimeoutError, readCappedText, withTimeout } from './util';

export interface DohRecord {
  name: string;
  type: number;
  ttl: number;
  data: string;
}

export interface DohResponse {
  status: number;
  answer: DohRecord[];
  authority: DohRecord[];
  truncated: boolean;
  resolver: 'cloudflare' | 'google';
}

const RESOLVERS = [
  {
    id: 'cloudflare' as const,
    build: (name: string, type: string) =>
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`,
  },
  {
    id: 'google' as const,
    build: (name: string, type: string) =>
      `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`,
  },
];

const MAX_DNS_RESPONSE = 256 * 1024;

interface DohJson {
  Status?: number;
  TC?: boolean;
  Answer?: Array<{ name?: string; type?: number; TTL?: number; data?: string }>;
  Authority?: Array<{ name?: string; type?: number; TTL?: number; data?: string }>;
}

function normalizeRecords(records: DohJson['Answer'], fallbackName: string): DohRecord[] {
  if (!Array.isArray(records)) return [];
  return records.map((record) => ({
    name: typeof record.name === 'string' ? record.name : fallbackName,
    type: typeof record.type === 'number' ? record.type : 0,
    ttl: typeof record.TTL === 'number' ? record.TTL : Number(record.TTL ?? 0) || 0,
    data: typeof record.data === 'string' ? record.data : String(record.data ?? ''),
  }));
}

async function queryResolver(
  resolver: (typeof RESOLVERS)[number],
  name: string,
  type: string,
  timeoutMs: number,
): Promise<DohResponse> {
  const response = await fetch(resolver.build(name, type), {
    headers: {
      accept: 'application/dns-json',
      'user-agent': 'NetScope/2.1 (+https://github.com/Jas0n0ss/lsp)',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`${resolver.id} returned HTTP ${response.status}.`);
  }
  const text = await readCappedText(response, MAX_DNS_RESPONSE);
  let data: DohJson;
  try {
    data = JSON.parse(text) as DohJson;
  } catch {
    throw new Error(`${resolver.id} returned an invalid DNS response.`);
  }
  return {
    status: typeof data.Status === 'number' ? data.Status : 0,
    answer: normalizeRecords(data.Answer, name),
    authority: normalizeRecords(data.Authority, name),
    truncated: Boolean(data.TC),
    resolver: resolver.id,
  };
}

/** Query one record type, falling back to the second resolver on failure. */
export async function dohQuery(name: string, type: string, timeoutMs = 4000): Promise<DohResponse> {
  let lastError: unknown = null;
  for (const resolver of RESOLVERS) {
    try {
      return await withTimeout(queryResolver(resolver, name, type, timeoutMs), timeoutMs + 250, 'The DNS query timed out.');
    } catch (error) {
      lastError = error;
    }
  }
  if (isTimeoutError(lastError)) {
    throw new TimeoutError('The DNS query timed out.');
  }
  throw new Error(errorMessage(lastError));
}

/** Resolve A + AAAA in parallel and return unique addresses. */
export async function resolveAddresses(name: string, timeoutMs = 4000): Promise<{ addresses: string[]; timedOut: boolean }> {
  const results = await Promise.allSettled([dohQuery(name, 'A', timeoutMs), dohQuery(name, 'AAAA', timeoutMs)]);
  const wanted = [1, 28];
  const addresses: string[] = [];
  let timedOut = true;
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      timedOut = false;
      for (const record of result.value.answer) {
        // A query can include CNAME records; only accept the address type.
        if (record.type !== wanted[index]) continue;
        const data = record.data.trim();
        if (!data) continue;
        if (!addresses.includes(data)) addresses.push(data);
      }
    } else if (!isTimeoutError(result.reason)) {
      timedOut = false;
    }
  });
  return { addresses, timedOut };
}

/** DNS RCODE -> text, mirroring the Flask DNS_STATUS table. */
export function statusText(status: number): string {
  const table: Record<number, string> = {
    0: 'NOERROR',
    1: 'FORMERR',
    2: 'SERVFAIL',
    3: 'NXDOMAIN',
    4: 'NOTIMP',
    5: 'REFUSED',
  };
  return table[status] ?? `Status ${status}`;
}

export function typeName(type: number): string {
  const table: Record<number, string> = {
    1: 'A',
    2: 'NS',
    5: 'CNAME',
    6: 'SOA',
    12: 'PTR',
    15: 'MX',
    16: 'TXT',
    28: 'AAAA',
    33: 'SRV',
    257: 'CAA',
  };
  return table[type] ?? String(type);
}
