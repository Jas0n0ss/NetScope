/**
 * Network layer — public IP, geolocation, DNS-over-HTTPS, RDAP and the
 * optional inspector API. Everything here runs in the browser.
 */

import type { DnsAnswer, DnsResult, IPInfo, MyIP, RdapResult } from './types';
import { isIPv4, isIPv6, isIP, reverseDnsName } from './tools';

export class ApiError extends Error {
  code: string;
  status?: number;
  hint?: string;

  constructor(message: string, code = 'error', meta: { status?: number; hint?: string } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = meta.status;
    this.hint = meta.hint;
  }
}

const DNS_TYPES: Record<number, string> = {
  1: 'A',
  2: 'NS',
  5: 'CNAME',
  6: 'SOA',
  12: 'PTR',
  15: 'MX',
  16: 'TXT',
  28: 'AAAA',
  33: 'SRV',
  35: 'NAPTR',
  39: 'DNAME',
  43: 'DS',
  46: 'RRSIG',
  48: 'DNSKEY',
  64: 'SVCB',
  65: 'HTTPS',
  255: 'ANY',
  257: 'CAA',
};

const DNS_STATUS: Record<number, string> = {
  0: 'NOERROR',
  1: 'FORMERR',
  2: 'SERVFAIL',
  3: 'NXDOMAIN',
  4: 'NOTIMP',
  5: 'REFUSED',
};

export async function fetchJSON<T = any>(
  url: string,
  { timeout = 9000, headers = {} }: { timeout?: number; headers?: Record<string, string> } = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json', ...headers },
    });
    const text = await response.text();
    let data: any;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new ApiError(
        response.ok ? 'The service returned a non-JSON response.' : `HTTP ${response.status} from ${new URL(url).host}`,
        'invalid_json',
        { status: response.status },
      );
    }
    if (!response.ok) {
      const message = data?.message || data?.error?.message || data?.error || `HTTP ${response.status}`;
      const code = data?.error?.code || (response.status === 429 ? 'rate_limited' : 'http');
      throw new ApiError(String(message), code, { status: response.status });
    }
    return data as T;
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw new ApiError('The request timed out. Please try again.', 'timeout');
    if (error instanceof ApiError) throw error;
    throw new ApiError('Network request failed. Check your connection or the service CORS policy.', 'network');
  } finally {
    clearTimeout(timer);
  }
}

/* --------------------------- target handling -------------------------- */

export function normalizeTarget(raw: string): { value: string; isIp: boolean } {
  let value = String(raw ?? '').trim();
  if (!value) throw new ApiError('Enter an IP address or domain name.', 'invalid_input');
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value)) {
    try {
      value = new URL(value).hostname;
    } catch {
      throw new ApiError('That URL could not be parsed.', 'invalid_input');
    }
  }
  value = value.replace(/^\[|\]$/g, '').replace(/\/.*$/, '').replace(/^\.+|\.+$/g, '');
  if (!value) throw new ApiError('Enter an IP address or domain name.', 'invalid_input');
  if (isIP(value)) return { value, isIp: true };
  if (!/^[\w.-]+\.[a-z]{2,}$/i.test(value) && !/^[\w-]+$/i.test(value)) {
    throw new ApiError('That does not look like a valid IP address or domain.', 'invalid_input');
  }
  try {
    value = new URL(`http://${value}`).hostname;
  } catch {
    throw new ApiError('That domain name could not be normalized.', 'invalid_input');
  }
  return { value: value.toLowerCase(), isIp: false };
}

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

function countryName(code?: string): string {
  if (!code) return '';
  try {
    return regionNames.of(String(code).toUpperCase()) || String(code).toUpperCase();
  } catch {
    return String(code).toUpperCase();
  }
}

const flagFromCode = (code?: string): string | null =>
  code && code.length === 2 ? `https://flagcdn.com/w40/${code.toLowerCase()}.png` : null;

const parseAsn = (value?: string): string => (value ? (String(value).match(/AS(\d+)/i)?.[1] ?? '') : '');

function normalizeIpWho(data: any): IPInfo {
  if (!data || data.success === false) {
    throw new ApiError(data?.message || 'The address could not be geolocated.', 'lookup_failed');
  }
  return {
    ip: data.ip,
    type: data.type || (isIPv6(data.ip) ? 'IPv6' : 'IPv4'),
    city: data.city || '',
    region: data.region || '',
    country: data.country || countryName(data.country_code),
    countryCode: data.country_code || '',
    continent: data.continent || '',
    postal: data.postal || '',
    latitude: data.latitude ?? null,
    longitude: data.longitude ?? null,
    timezone: {
      id: data.timezone?.id || '',
      abbr: data.timezone?.abbr || '',
      utc: data.timezone?.utc || '',
      offset: data.timezone?.offset ?? null,
    },
    flag: data.flag?.img || flagFromCode(data.country_code),
    isp: data.connection?.isp || '',
    org: data.connection?.org || '',
    asn: data.connection?.asn ? String(data.connection.asn) : '',
    domain: data.connection?.domain || '',
    source: 'ipwho.is',
  };
}

function normalizeIpInfo(data: any, target: string): IPInfo {
  if (!data || !data.ip) throw new ApiError('No data returned by ipinfo.io.', 'lookup_failed');
  const [lat, lon] = String(data.loc || '').split(',').map(Number);
  const orgName = String(data.org || '').replace(/^AS\d+\s+/i, '');
  return {
    ip: data.ip,
    type: isIPv6(data.ip) ? 'IPv6' : 'IPv4',
    city: data.city || '',
    region: data.region || '',
    country: countryName(data.country),
    countryCode: data.country || '',
    postal: data.postal || '',
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lon) ? lon : null,
    timezone: { id: data.timezone || '', abbr: '', utc: '', offset: null },
    flag: flagFromCode(data.country),
    isp: orgName,
    org: orgName,
    asn: parseAsn(data.org),
    domain: data.hostname || '',
    source: 'ipinfo.io',
    resolvedFrom: target,
  };
}

function normalizeIpSb(data: any): IPInfo {
  if (!data || !data.ip) throw new ApiError('No data returned by api.ip.sb.', 'lookup_failed');
  return {
    ip: data.ip,
    type: isIPv6(data.ip) ? 'IPv6' : 'IPv4',
    city: data.city || '',
    region: data.region || '',
    country: data.country || countryName(data.country_code),
    countryCode: data.country_code || '',
    continent: data.continent_code || '',
    postal: '',
    latitude: data.latitude ?? null,
    longitude: data.longitude ?? null,
    timezone: { id: data.timezone || '', abbr: '', utc: '', offset: data.offset ?? null },
    flag: flagFromCode(data.country_code),
    isp: data.isp || data.organization || '',
    org: data.asn_organization || data.organization || '',
    asn: data.asn ? String(data.asn) : '',
    domain: '',
    source: 'api.ip.sb',
  };
}

/* ------------------------------- public IP ---------------------------- */

async function ipify(url: string): Promise<string | null> {
  try {
    const data = await fetchJSON<{ ip?: string }>(url, { timeout: 6500 });
    return typeof data?.ip === 'string' ? data.ip : null;
  } catch {
    return null;
  }
}

export async function myAddresses(): Promise<{ ipv4: string | null; ipv6: string | null }> {
  const [v4, v64] = await Promise.all([ipify('https://api.ipify.org?format=json'), ipify('https://api64.ipify.org?format=json')]);
  const ipv4Value = v4 && isIPv4(v4) ? v4 : null;
  const ipv6Value = v64 && isIPv6(v64) ? v64 : null;
  const fallbackV4 = v64 && isIPv4(v64) ? v64 : null;
  return { ipv4: ipv4Value || fallbackV4 || (v4 ? v4 : null), ipv6: ipv6Value };
}

const lookupCache = new Map<string, { ts: number; data: IPInfo }>();
const LOOKUP_TTL = 5 * 60 * 1000;

async function lookupProvider(target: string): Promise<IPInfo> {
  const providers: (() => Promise<IPInfo>)[] = [
    async () => normalizeIpWho(await fetchJSON(`https://ipwho.is/${encodeURIComponent(target)}`, { timeout: 8000 })),
    async () =>
      normalizeIpInfo(await fetchJSON(`https://ipinfo.io/${encodeURIComponent(target)}/json`, { timeout: 8000 }), target),
    async () => normalizeIpSb(await fetchJSON(`https://api.ip.sb/geoip/${encodeURIComponent(target)}`, { timeout: 8000 })),
  ];
  let lastError: unknown = null;
  for (const provider of providers) {
    try {
      return await provider();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new ApiError('All geolocation providers failed.', 'lookup_failed');
}

export async function lookupIP(rawTarget: string): Promise<IPInfo> {
  const { value, isIp } = normalizeTarget(rawTarget);
  let target = value;
  let resolvedFrom: string | null = null;
  let resolvedRecord: string | null = null;

  if (!isIp) {
    const answer = await dohQuery(value, 'A', 'cloudflare').catch(() => dohQuery(value, 'AAAA', 'cloudflare'));
    const record = answer.answers?.find((entry) => entry.typeName === 'A' || entry.typeName === 'AAAA');
    if (!record) throw new ApiError(`No A or AAAA record found for ${value}.`, 'no_dns_record');
    target = record.data;
    resolvedFrom = value;
    resolvedRecord = record.typeName;
  }

  const cached = lookupCache.get(target.toLowerCase());
  if (cached && Date.now() - cached.ts < LOOKUP_TTL) {
    return { ...cached.data, resolvedFrom, resolvedRecord, cached: true };
  }

  const info = await lookupProvider(target);
  const result: IPInfo = { ...info, resolvedFrom, resolvedRecord };
  lookupCache.set(target.toLowerCase(), { ts: Date.now(), data: result });
  return result;
}

export async function myIP(): Promise<MyIP> {
  const addresses = await myAddresses();
  const primary = addresses.ipv4 || addresses.ipv6;
  if (!primary) {
    throw new ApiError('Could not determine your public IP. A privacy extension or firewall may be blocking the lookup.', 'no_ip');
  }
  let info: IPInfo;
  try {
    info = await lookupIP(primary);
  } catch {
    info = {
      ip: primary,
      type: primary.includes(':') ? 'IPv6' : 'IPv4',
      city: '',
      region: '',
      country: '',
      countryCode: '',
      postal: '',
      latitude: null,
      longitude: null,
      timezone: { id: '', abbr: '', utc: '', offset: null },
      flag: null,
      isp: '',
      org: '',
      asn: '',
      domain: '',
      source: 'ipify',
    };
  }
  return {
    ...info,
    primary: info.ip || primary,
    ipv4: addresses.ipv4 || (isIPv4(primary) ? primary : null),
    ipv6: addresses.ipv6 || (isIPv6(primary) ? primary : null),
  };
}

/* --------------------------------- DoH -------------------------------- */

const RESOLVERS = {
  cloudflare: {
    name: 'Cloudflare',
    build: (name: string, type: string) =>
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`,
    headers: { Accept: 'application/dns-json' } as Record<string, string>,
  },
  google: {
    name: 'Google',
    build: (name: string, type: string) =>
      `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`,
    headers: { Accept: 'application/dns-json' } as Record<string, string>,
  },
};

function normalizeDns(
  data: any,
  { name, type, resolver, elapsedMs }: { name: string; type: string; resolver: { name: string; id: string }; elapsedMs: number },
): DnsResult {
  const map = (entry: any): DnsAnswer => ({
    name: entry.name || name,
    type: entry.type,
    typeName: DNS_TYPES[entry.type] || String(entry.type),
    ttl: entry.TTL ?? null,
    data: entry.data ?? '',
  });
  return {
    name,
    type,
    resolver: resolver.name,
    resolverId: resolver.id,
    status: data.Status ?? -1,
    statusText: DNS_STATUS[data.Status] || `Status ${data.Status}`,
    truncated: Boolean(data.TC),
    answers: (data.Answer || []).map(map),
    authority: (data.Authority || []).map(map),
    elapsedMs,
  };
}

export async function dohQuery(rawName: string, type = 'A', resolverId: keyof typeof RESOLVERS = 'cloudflare'): Promise<DnsResult> {
  let name = String(rawName ?? '').trim().replace(/^\[|\]$/g, '');
  if (!name) throw new ApiError('Enter a domain name or IP address.', 'invalid_input');
  if (type === 'PTR' && isIP(name)) name = reverseDnsName(name) as string;
  name = name.replace(/\.$/, '');

  const order = [resolverId, resolverId === 'cloudflare' ? 'google' : 'cloudflare'].filter(
    (id) => RESOLVERS[id as keyof typeof RESOLVERS],
  ) as (keyof typeof RESOLVERS)[];

  let lastError: unknown;
  for (const id of order) {
    const resolver = { ...RESOLVERS[id], id };
    const started = performance.now();
    try {
      const data = await fetchJSON(resolver.build(name, type), { timeout: 9000, headers: resolver.headers });
      return normalizeDns(data, { name, type, resolver, elapsedMs: Math.round(performance.now() - started) });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new ApiError('DNS resolution failed.', 'dns_failed');
}

/* -------------------------------- RDAP -------------------------------- */

function vcardName(entity: any): string {
  const card = entity?.vcardArray?.[1];
  if (!Array.isArray(card)) return '';
  for (const row of card) if (Array.isArray(row) && row[0] === 'fn' && row[3]) return String(row[3]);
  return '';
}

function collectEntities(list: any[], accumulator: any[] = []): any[] {
  for (const entity of list || []) {
    accumulator.push(entity);
    collectEntities(entity.entities, accumulator);
  }
  return accumulator;
}

function entityEmail(entity: any): string {
  const card = entity?.vcardArray?.[1];
  if (!Array.isArray(card)) return '';
  for (const row of card) if (Array.isArray(row) && row[0] === 'email' && row[3]) return String(row[3]);
  return '';
}

export async function rdapLookup(kind: 'domain' | 'ip', rawValue: string): Promise<RdapResult> {
  const value = String(rawValue ?? '').trim();
  if (!value) throw new ApiError('Enter a domain or IP address.', 'invalid_input');

  const started = performance.now();
  const data = await fetchJSON(`https://rdap.org/${kind}/${encodeURIComponent(value)}`, { timeout: 15000 });
  const elapsedMs = Math.round(performance.now() - started);

  const events: Record<string, string> = {};
  for (const event of data.events || []) {
    if (event?.eventAction) events[String(event.eventAction).toLowerCase()] = event.eventDate || '';
  }

  const entities = collectEntities(data.entities);
  const registrarEntity =
    entities.find((entity) => (entity.roles || []).includes('registrar')) ||
    entities.find((entity) => (entity.roles || []).includes('registrant')) ||
    entities[0];
  const abuseEntity = entities.find((entity) => (entity.roles || []).includes('abuse'));
  const nameservers = (data.nameservers || []).map((server: any) => server.ldhName || server.unicodeName).filter(Boolean);
  const secureDns = data.secureDNS || {};

  return {
    kind,
    value,
    elapsedMs,
    handle: data.handle || '',
    name: data.ldhName || data.name || data.unicodeName || value,
    statuses: Array.isArray(data.status) ? data.status : [],
    events,
    registrar: vcardName(registrarEntity),
    registrarUrl: (registrarEntity?.links || []).find((link: any) => link.rel === 'about')?.href || '',
    abuseEmail: entityEmail(abuseEntity) || '',
    nameservers,
    dnssec:
      typeof secureDns.delegationSigned === 'boolean' ? (secureDns.delegationSigned ? 'Signed' : 'Unsigned') : null,
    startAddress: data.startAddress || '',
    endAddress: data.endAddress || '',
    country: data.country || '',
    type: data.type || '',
    ipVersion: data.ipVersion || '',
    range: data.startAddress && data.endAddress ? `${data.startAddress} – ${data.endAddress}` : '',
    selfLink: (data.links || []).find((link: any) => link.rel === 'self')?.href || '',
  };
}

/* --------------------------- optional API ----------------------------- */

export type ApiHealth = { online: boolean; base: string; error: string | null; data?: any };

export function getApiBase(): string {
  try {
    return String(localStorage.getItem('netscope.apiBase') || '').trim().replace(/\/$/, '');
  } catch {
    return '';
  }
}

export function apiUrl(path: string): string {
  return `${getApiBase()}${path}`;
}

let healthCache: { ts: number; base: string; result: ApiHealth } | null = null;

export async function healthCheck(force = false): Promise<ApiHealth> {
  const base = getApiBase();
  if (!base) return { online: false, base, error: 'No inspector API configured.' };
  if (!force && healthCache && healthCache.base === base && Date.now() - healthCache.ts < 15000) return healthCache.result;

  try {
    const data = await fetchJSON<any>(apiUrl('/api/health'), { timeout: 3200 });
    const online = Boolean(data && (data.ok === true || data.service === 'netscope'));
    const result: ApiHealth = { online, base, data, error: online ? null : 'Unexpected health response.' };
    healthCache = { ts: Date.now(), base, result };
    return result;
  } catch (error) {
    const result: ApiHealth = { online: false, base, error: (error as Error).message };
    healthCache = { ts: Date.now(), base, result };
    return result;
  }
}

export function invalidateHealthCache(): void {
  healthCache = null;
}

function requireOnline(payload: any): any {
  if (!payload || payload.ok !== true) {
    const message = payload?.error?.message || payload?.error || 'The inspector API returned an unexpected response.';
    throw new ApiError(String(message), payload?.error?.code || 'api_error', { hint: payload?.error?.hint || '' });
  }
  return payload;
}

export async function inspectWebsite(url: string): Promise<any> {
  return requireOnline(await fetchJSON(apiUrl(`/api/inspect?url=${encodeURIComponent(url)}`), { timeout: 30000 }));
}

export async function checkSMTP(host: string, port: number, mode = 'auto'): Promise<any> {
  const params = new URLSearchParams({ host, port: String(port), mode });
  return requireOnline(await fetchJSON(apiUrl(`/api/smtp?${params.toString()}`), { timeout: 30000 }));
}

export async function checkPort(host: string, port: number): Promise<any> {
  return requireOnline(
    await fetchJSON(apiUrl(`/api/port?host=${encodeURIComponent(host)}&port=${encodeURIComponent(port)}`), {
      timeout: 12000,
    }),
  );
}

export { DNS_TYPES, DNS_STATUS };
