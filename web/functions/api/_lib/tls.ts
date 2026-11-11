/**
 * TLS certificate metadata.
 *
 * Workers cannot read a peer certificate from `fetch()` or `connect()`, so the
 * certificate is reconstructed from Certificate Transparency logs:
 *   - https://crt.sh/?q=<host>&output=json  (metadata, cached by crt.sh)
 *   - https://crt.sh/?d=<id>                (the certificate itself, for the
 *                                            SHA-256 fingerprint)
 *
 * Everything here is best effort: failures are reported as `{ error }` and
 * never thrown, matching the Flask endpoint's contract.
 */

import { errorMessage, isTimeoutError, readCappedBytes } from './util';
import { isIP } from './ip';
import { sslLabsInfo } from './ssllabs';

export interface TlsDetails {
  subject: string;
  issuer: string;
  valid_from: string;
  valid_to: string;
  days_remaining: number;
  sans: string[];
  serial: string;
  fingerprint_sha256: string;
  version: string;
  cipher: string;
  source: string;
}

export interface TlsError {
  error: string;
}

export type TlsResult = TlsDetails | TlsError;

export function isTlsError(value: TlsResult): value is TlsError {
  return typeof (value as TlsError).error === 'string';
}

interface CrtShRow {
  id?: number | string;
  common_name?: string;
  name_value?: string;
  issuer_name?: string;
  not_before?: string;
  not_after?: string;
  serial_number?: string;
}

interface Candidate {
  row: CrtShRow;
  notBefore: number;
  notAfter: number;
}

const CRT_SH_TIMEOUT = 8000;
const CRT_SH_MAX_BYTES = 4 * 1024 * 1024;
const CRT_SH_FINGERPRINT_TIMEOUT = 4500;
const USER_AGENT = 'NetScope/2.1 (+https://github.com/Jas0n0ss/lsp)';

function parseCrtDate(value: string | undefined): number | null {
  if (!value) return null;
  const text = value.trim();
  if (!text) return null;
  // crt.sh timestamps are UTC but have no zone suffix.
  const normalized = /(Z|[+-]\d\d:?\d\d)$/.test(text) ? text : `${text}Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Flask returns `datetime.isoformat()`; produce the same shape (+00:00). */
function isoUtc(milliseconds: number): string {
  const iso = new Date(milliseconds).toISOString();
  const withoutMillis = iso.endsWith('.000Z') ? iso.slice(0, -5) : iso.slice(0, -1);
  return `${withoutMillis}+00:00`;
}

function sanitizeSan(value: string): string | null {
  const text = value.trim().replace(/\.$/, '');
  if (!text) return null;
  if (isIP(text)) return text;
  if (/^(\*\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(text)) {
    return text;
  }
  return null;
}

function hostCovered(pattern: string, host: string): boolean {
  const value = pattern.trim().replace(/\.$/, '').toLowerCase();
  if (!value) return false;
  if (value === host) return true;
  if (value.startsWith('*.')) {
    const suffix = value.slice(1); // ".example.com"
    if (!host.endsWith(suffix)) return false;
    const label = host.slice(0, host.length - suffix.length);
    return label.length > 0 && !label.includes('.');
  }
  return false;
}

function certificateNames(row: CrtShRow): string[] {
  const names: string[] = [];
  if (row.common_name) names.push(row.common_name);
  if (row.name_value) names.push(...row.name_value.split('\n'));
  return names;
}

function rowCoversHost(row: CrtShRow, host: string): boolean {
  return certificateNames(row).some((name) => hostCovered(name, host));
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function fetchCrtShRowsOnce(host: string, timeoutMs: number): Promise<CrtShRow[]> {
  // `exclude=expired` and `deduplicate=Y` shrink the payload by an order of
  // magnitude (github.com: 1225 rows / 416 KB → 33 rows / 11 KB) and cut the
  // chance of a truncated or rate-limited response.
  const url = `https://crt.sh/?q=${encodeURIComponent(host)}&output=json&exclude=expired&deduplicate=Y`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (isTimeoutError(error)) throw new Error('the certificate transparency lookup timed out.');
    throw new Error(errorMessage(error));
  }
  if (!response.ok) throw new Error(`crt.sh returned HTTP ${response.status}.`);

  const text = await readCappedBytes(response, CRT_SH_MAX_BYTES).then((bytes) => new TextDecoder().decode(bytes));
  if (!text.trim()) throw new Error('crt.sh returned an empty response.');
  if (text.trimStart().startsWith('<')) throw new Error('crt.sh returned an unexpected HTML response.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('crt.sh returned an invalid JSON response.');
  }
  if (!Array.isArray(parsed)) throw new Error('crt.sh returned an unexpected JSON payload.');
  return parsed as CrtShRow[];
}

/**
 * crt.sh is slow and intermittently answers 502/HTML, so every failure is
 * retried once: two 8 s attempts stay well inside the 30 s Worker limit and
 * turn the majority of transient failures into a usable response.
 */
async function fetchCrtShRows(host: string, timeoutMs: number): Promise<CrtShRow[]> {
  try {
    return await fetchCrtShRowsOnce(host, timeoutMs);
  } catch {
    return fetchCrtShRowsOnce(host, timeoutMs);
  }
}

async function fetchFingerprint(id: number | string, timeoutMs: number): Promise<string> {
  try {
    let response = await fetch(`https://crt.sh/?d=${encodeURIComponent(String(id))}`, {
      headers: { accept: 'application/pkix-cert, application/x-pem-file, */*', 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      // crt.sh also 502s on the certificate download endpoint; retry once.
      response = await fetch(`https://crt.sh/?d=${encodeURIComponent(String(id))}`, {
        headers: { accept: 'application/pkix-cert, application/x-pem-file, */*', 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
      });
    }
    if (!response.ok) return '';
    const bytes = await readCappedBytes(response, 512 * 1024);
    if (bytes.byteLength === 0) return '';

    let der = bytes;
    const head = new TextDecoder().decode(bytes.subarray(0, 64));
    if (head.includes('BEGIN CERTIFICATE')) {
      // crt.sh serves some certificates as PEM despite the DER endpoint.
      const pem = new TextDecoder().decode(bytes);
      const match = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/.exec(pem);
      if (!match) return '';
      der = base64ToBytes(match[1].replace(/\s+/g, ''));
    }
    if (der.byteLength === 0 || der[0] !== 0x30) return '';

    const digest = await crypto.subtle.digest('SHA-256', der as unknown as BufferSource);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0').toUpperCase())
      .join(':');
  } catch {
    return '';
  }
}

export interface TlsLookupOptions {
  timeoutMs?: number;
  /** Fetch the leaf certificate to compute the SHA-256 fingerprint. */
  fingerprint?: boolean;
  fingerprintTimeoutMs?: number;
}

const CACHE_PREFIX = 'https://netscope-ct-cache.invalid/';
const CACHE_TTL_SECONDS = 3600;

/**
 * crt.sh rate-limits bursty clients, so successful lookups are kept in the
 * per-colo Cache API for an hour. Errors are never cached, so a transient
 * failure can be retried immediately.
 */
function edgeCache(): Cache | null {
  const globalCaches = (globalThis as { caches?: CacheStorage }).caches;
  const store = (globalCaches as unknown as { default?: Cache } | undefined)?.default;
  return store ?? null;
}

async function readCache(host: string): Promise<TlsDetails | null> {
  try {
    const store = edgeCache();
    if (!store) return null;
    const hit = await store.match(new Request(`${CACHE_PREFIX}${encodeURIComponent(host)}`));
    if (!hit) return null;
    return (await hit.json()) as TlsDetails;
  } catch {
    return null;
  }
}

async function writeCache(host: string, details: TlsDetails): Promise<void> {
  try {
    const store = edgeCache();
    if (!store) return;
    await store.put(
      new Request(`${CACHE_PREFIX}${encodeURIComponent(host)}`),
      new Response(JSON.stringify(details), {
        headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${CACHE_TTL_SECONDS}` },
      }),
    );
  } catch {
    /* caching is optional */
  }
}

/**
 * Look up certificate details for `host` in Certificate Transparency logs.
 * Never throws: failures come back as `{ error: "..." }`.
 */
export async function tlsInfo(host: string, port = 443, options: TlsLookupOptions = {}): Promise<TlsResult> {
  const timeoutMs = options.timeoutMs ?? CRT_SH_TIMEOUT;
  const withFingerprint = options.fingerprint ?? true;
  const asciiHost = host.trim().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '').toLowerCase();
  void port;

  try {
    if (!asciiHost) throw new Error('no hostname was supplied.');
    const cached = await readCache(asciiHost);
    if (cached) return cached;

    // SSL Labs keeps public analyses online and answers in ~1-2 s when a host
    // is already analysed, so it is the fast path; CT below is the fallback.
    const fromSslLabs = await sslLabsInfo(asciiHost, port || 443);
    if (fromSslLabs) {
      await writeCache(asciiHost, fromSslLabs);
      return fromSslLabs;
    }

    const now = Date.now();
    const collect = (rows: CrtShRow[]): Candidate[] => {
      const found: Candidate[] = [];
      for (const row of rows) {
        if (!rowCoversHost(row, asciiHost)) continue;
        const notBefore = parseCrtDate(row.not_before);
        const notAfter = parseCrtDate(row.not_after);
        if (notBefore === null || notAfter === null) continue;
        if (notAfter <= now) continue;
        // Allow a little clock skew for certificates issued moments ago.
        if (notBefore > now + 5 * 60 * 1000) continue;
        found.push({ row, notBefore, notAfter });
      }
      return found;
    };

    let candidates = collect(await fetchCrtShRows(asciiHost, timeoutMs));
    if (candidates.length === 0) {
      // A wildcard certificate is logged under the parent name, so
      // `www.example.com` only shows up in a `example.com` search.
      const parent = asciiHost.split('.').slice(1).join('.');
      if (parent.includes('.')) {
        try {
          candidates = collect(await fetchCrtShRows(parent, timeoutMs));
        } catch {
          /* keep the original "not found" failure below */
        }
      }
    }

    if (candidates.length === 0) {
      throw new Error(`no currently valid certificate covering ${asciiHost} was found in Certificate Transparency logs.`);
    }

    candidates.sort((left, right) => right.notBefore - left.notBefore || Number(right.row.id ?? 0) - Number(left.row.id ?? 0));
    const chosen = candidates[0];

    const sans: string[] = [];
    const seen = new Set<string>();
    for (const raw of (chosen.row.name_value ?? '').split('\n')) {
      const name = sanitizeSan(raw);
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      sans.push(name);
    }

    let fingerprint = '';
    if (withFingerprint && chosen.row.id !== undefined && chosen.row.id !== null) {
      fingerprint = await fetchFingerprint(chosen.row.id, options.fingerprintTimeoutMs ?? CRT_SH_FINGERPRINT_TIMEOUT);
    }

    const details: TlsDetails = {
      subject: String(chosen.row.common_name ?? ''),
      issuer: String(chosen.row.issuer_name ?? ''),
      valid_from: isoUtc(chosen.notBefore),
      valid_to: isoUtc(chosen.notAfter),
      days_remaining: Math.ceil((chosen.notAfter - now) / 86400000),
      sans,
      serial: String(chosen.row.serial_number ?? ''),
      fingerprint_sha256: fingerprint,
      version: '',
      cipher: '',
      source: 'certificate-transparency',
    };
    await writeCache(asciiHost, details);
    return details;
  } catch (error) {
    const reason = errorMessage(error).trim().replace(/\.+$/, '');
    return { error: `Certificate details are unavailable: ${reason}.` };
  }
}
