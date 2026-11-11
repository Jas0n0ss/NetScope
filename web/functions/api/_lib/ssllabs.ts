/**
 * Last-resort certificate lookup through the SSL Labs cached analysis API.
 *
 * Workers cannot read a peer certificate (`node:tls` implements `connect`
 * but not `getPeerCertificate`), and crt.sh is slow and rate-limits Cloudflare
 * egress, so both primary sources can fail. SSL Labs keeps public analyses
 * online: `fromCache=on` only reads results that already exist (a lookup for an
 * unanalysed host returns `IN_PROGRESS` and is ignored), and a 24 hour max age
 * keeps the data current.
 *
 * Everything here is best effort: no result means "fall back", never an error.
 */

import type { TlsDetails } from './tls';
import { errorMessage, readCappedBytes } from './util';

const SSL_LABS_TIMEOUT = 4000;
const SSL_LABS_MAX_AGE_HOURS = 24;
const SSL_LABS_MAX_BYTES = 1024 * 1024;

interface SslLabsCert {
  subject?: string;
  issuerSubject?: string;
  notBefore?: number;
  notAfter?: number;
  altNames?: string[];
  serialNumber?: string;
  sha256Hash?: string;
}

interface SslLabsAnalysis {
  status?: string;
  certs?: SslLabsCert[];
}

function isoUtc(milliseconds: number): string {
  const iso = new Date(milliseconds).toISOString();
  const withoutMillis = iso.endsWith('.000Z') ? iso.slice(0, -5) : iso.slice(0, -1);
  return `${withoutMillis}+00:00`;
}

function colonHex(value: string | undefined): string {
  if (!value) return '';
  const hex = value.replace(/[^0-9a-f]/gi, '').toUpperCase();
  const pairs = hex.match(/.{1,2}/g);
  return pairs ? pairs.join(':') : '';
}

function sanList(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  const output: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const name = String(raw ?? '').trim().replace(/\.$/, '');
    if (!name || /\s/.test(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(name);
  }
  return output;
}

export async function sslLabsInfo(host: string, port: number, timeoutMs = SSL_LABS_TIMEOUT): Promise<TlsDetails | null> {
  try {
    const query = new URLSearchParams({
      host,
      port: String(port || 443),
      fromCache: 'on',
      maxAge: String(SSL_LABS_MAX_AGE_HOURS),
      all: 'done',
    });
    const response = await fetch(`https://api.ssllabs.com/api/v3/analyze?${query.toString()}`, {
      headers: { accept: 'application/json', 'user-agent': 'NetScope/2.1 (+https://lsp.404x.io)' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;

    const text = new TextDecoder().decode(await readCappedBytes(response, SSL_LABS_MAX_BYTES));
    if (!text.trim() || text.trimStart().startsWith('<')) return null;

    const analysis = JSON.parse(text) as SslLabsAnalysis;
    if (analysis.status !== 'READY') return null;

    const cert = (analysis.certs ?? [])[0];
    if (!cert || typeof cert.notAfter !== 'number') return null;

    return {
      subject: String(cert.subject ?? ''),
      issuer: String(cert.issuerSubject ?? ''),
      valid_from: typeof cert.notBefore === 'number' ? isoUtc(cert.notBefore) : '',
      valid_to: isoUtc(cert.notAfter),
      days_remaining: Math.ceil((cert.notAfter - Date.now()) / 86400000),
      sans: sanList(cert.altNames),
      serial: String(cert.serialNumber ?? '').toUpperCase(),
      fingerprint_sha256: colonHex(cert.sha256Hash),
      version: '',
      cipher: '',
      source: 'ssl-labs-cache',
    };
  } catch (error) {
    console.warn('SSL Labs lookup skipped:', errorMessage(error));
    return null;
  }
}
