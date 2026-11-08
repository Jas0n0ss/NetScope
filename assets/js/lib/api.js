/**
 * NetScope data layer — public IP, geolocation, DNS-over-HTTPS, RDAP and the
 * optional NetScope inspector API.
 */

import { getApiBase, apiUrl } from './core.js';
import { getLanguage, getLocale, t } from './i18n.js';
import { isIPv4, isIPv6, isIP, reverseDnsName } from './tools.js';

const DNS_TYPES = {
  1: 'A', 2: 'NS', 5: 'CNAME', 6: 'SOA', 12: 'PTR', 15: 'MX', 16: 'TXT',
  28: 'AAAA', 33: 'SRV', 35: 'NAPTR', 39: 'DNAME', 43: 'DS', 46: 'RRSIG',
  48: 'DNSKEY', 64: 'SVCB', 65: 'HTTPS', 255: 'ANY', 257: 'CAA',
};

const DNS_STATUS = {
  0: 'NOERROR', 1: 'FORMERR', 2: 'SERVFAIL', 3: 'NXDOMAIN', 4: 'NOTIMP', 5: 'REFUSED',
};

function countryDisplayNames() {
  try {
    return new Intl.DisplayNames([getLocale()], { type: 'region' });
  } catch {
    return null;
  }
}

const ERROR_ZH = {
  timeout: '请求超时，请重试。',
  network: '网络请求失败，请检查网络连接或服务的 CORS 设置。',
  invalid_json: '服务返回了无法解析的响应。',
  http: '请求失败，请稍后重试。',
  blocked_host: '不允许访问私有、回环、链路本地或保留地址。',
  invalid_url: 'URL 无效。',
  invalid_scheme: '只能检测 http:// 和 https:// 地址。',
  invalid_host: '主机名无效。',
  dns_error: '无法解析该主机名。',
  missing_url: '请提供 url 参数。',
  missing_host: '请提供 host 参数。',
  missing_name: '请提供 name 参数。',
  invalid_name: '域名无效。',
  invalid_type: '不支持的记录类型。',
  invalid_port: '端口无效。',
  invalid_mode: '连接模式必须是 auto、starttls 或 implicit。',
  too_many_redirects: '重定向次数过多。',
  upstream_timeout: '上游服务器响应超时。',
  upstream_error: '无法访问目标网站。',
  rate_limited: '请求过于频繁，请稍后再试。',
  internal_error: '服务器内部错误。',
  not_found: '接口不存在。',
  method_not_allowed: '请求方法不允许。',
  dns_unavailable: '服务端 DNS 不可用，请使用浏览器 DoH 解析器。',
  dns_timeout: 'DNS 查询超时。',
  no_dns_record: '未找到对应的 DNS 记录。',
  lookup_failed: '地址查询失败。',
  no_ip: '无法确定公网 IP。',
  smtp_response_too_large: 'SMTP 响应过大。',
  api_error: '检测 API 返回了错误。',
  invalid_input: '输入无效。',
};

function localizeError(code, fallback) {
  return getLanguage() === 'zh' ? (ERROR_ZH[code] || fallback) : fallback;
}

export class ApiError extends Error {
  constructor(message, code = 'error', meta = {}) {
    super(localizeError(code, message));
    this.name = 'ApiError';
    this.code = code;
    this.rawMessage = message;
    Object.assign(this, meta);
  }
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

export async function fetchJSON(url, { timeout = 9000, headers = {} } = {}) {
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
    let data;
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
      const code = data?.error?.code || 'http';
      throw new ApiError(String(message), code, { status: response.status, data });
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new ApiError('The request timed out. Please try again.', 'timeout');
    if (error instanceof ApiError) throw error;
    throw new ApiError('Network request failed. Check your connection and the service CORS policy.', 'network');
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* Target normalization & provider adapters                            */
/* ------------------------------------------------------------------ */

export function normalizeTarget(raw) {
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

function countryName(code) {
  if (!code) return '';
  try {
    return countryDisplayNames()?.of(String(code).toUpperCase()) || String(code).toUpperCase();
  } catch {
    return String(code).toUpperCase();
  }
}

function flagFromCode(code) {
  if (!code || String(code).length !== 2) return null;
  return `https://flagcdn.com/w40/${String(code).toLowerCase()}.png`;
}

function parseAsn(value) {
  if (!value) return '';
  const match = String(value).match(/AS(\d+)/i);
  return match ? match[1] : '';
}

function normalizeIpWho(data, source = 'ipwho.is') {
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
    latitude: data.latitude,
    longitude: data.longitude,
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
    callingCode: data.calling_code || '',
    source,
  };
}

function normalizeIpInfo(data, target, source = 'ipinfo.io') {
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
    continent: '',
    postal: data.postal || '',
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lon) ? lon : null,
    timezone: { id: data.timezone || '', abbr: '', utc: '', offset: null },
    flag: flagFromCode(data.country),
    isp: orgName,
    org: orgName,
    asn: parseAsn(data.org),
    domain: data.hostname || '',
    callingCode: '',
    source,
    target,
  };
}

function normalizeIpSb(data, source = 'api.ip.sb') {
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
    latitude: data.latitude,
    longitude: data.longitude,
    timezone: { id: data.timezone || '', abbr: '', utc: '', offset: data.offset ?? null },
    flag: flagFromCode(data.country_code),
    isp: data.isp || data.organization || '',
    org: data.asn_organization || data.organization || '',
    asn: data.asn ? String(data.asn) : '',
    domain: '',
    callingCode: '',
    source,
  };
}

const lookupCache = new Map();
const LOOKUP_TTL = 5 * 60 * 1000;

export function clearLookupCache() {
  lookupCache.clear();
}

/* ------------------------------------------------------------------ */
/* IP addresses                                                        */
/* ------------------------------------------------------------------ */

async function ipify(url) {
  const data = await fetchJSON(url, { timeout: 6500 });
  return typeof data?.ip === 'string' ? data.ip : null;
}

export async function myAddresses() {
  const [v4, v64] = await Promise.allSettled([
    ipify('https://api.ipify.org?format=json'),
    ipify('https://api64.ipify.org?format=json'),
  ]);
  const ipv4Value = v4.status === 'fulfilled' && isIPv4(v4.value) ? v4.value : null;
  const ipv6Value = v64.status === 'fulfilled' && isIPv6(v64.value) ? v64.value : null;
  const fallbackV4 = v64.status === 'fulfilled' && isIPv4(v64.value) ? v64.value : null;
  return {
    ipv4: ipv4Value || fallbackV4,
    ipv6: ipv6Value,
  };
}

async function lookupProvider(target) {
  const providers = [
    async () => normalizeIpInfo(
      await fetchJSON(`https://ipinfo.io/${encodeURIComponent(target)}/json`, { timeout: 8000 }),
      target,
    ),
    async () => normalizeIpWho(
      await fetchJSON(`https://ipwho.is/${encodeURIComponent(target)}`, { timeout: 8000 }),
    ),
    async () => normalizeIpSb(
      await fetchJSON(`https://api.ip.sb/geoip/${encodeURIComponent(target)}`, { timeout: 8000 }),
    ),
  ];
  let lastError = null;
  for (const provider of providers) {
    try {
      return await provider();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new ApiError('All geolocation providers failed.', 'lookup_failed');
}

/**
 * Look up an IP address or resolve a domain and look up its first address.
 * Results are cached for five minutes.
 */
export async function lookupIP(rawTarget) {
  const { value, isIp } = normalizeTarget(rawTarget);
  let target = value;
  let resolvedFrom = null;
  let resolvedRecord = null;

  if (!isIp) {
    const answer = await dohQuery(value, 'A', 'cloudflare').catch(() => dohQuery(value, 'AAAA', 'cloudflare'));
    const record = answer.answers?.find((entry) => entry.typeName === 'A' || entry.typeName === 'AAAA');
    if (!record) {
      throw new ApiError(`No A or AAAA record found for ${value}.`, 'no_dns_record');
    }
    target = record.data;
    resolvedFrom = value;
    resolvedRecord = record.typeName;
  }

  const cacheKey = target.toLowerCase();
  const cached = lookupCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < LOOKUP_TTL) {
    return { ...cached.data, resolvedFrom, resolvedRecord, cached: true };
  }

  const info = await lookupProvider(target);
  const result = { ...info, resolvedFrom, resolvedRecord };
  lookupCache.set(cacheKey, { ts: Date.now(), data: result });
  return result;
}

/** Public IP plus geolocation, with graceful fallbacks. */
export async function myIP() {
  const addresses = await myAddresses();
  const primary = addresses.ipv4 || addresses.ipv6;
  if (!primary) {
    throw new ApiError('Could not determine your public IP address. A privacy extension or firewall may be blocking the lookup.', 'no_ip');
  }
  let info;
  try {
    info = await lookupIP(primary);
  } catch {
    info = {
      ip: primary,
      type: primary.includes(':') ? 'IPv6' : 'IPv4',
      city: '', region: '', country: '', countryCode: '', postal: '',
      latitude: null, longitude: null, timezone: { id: '', abbr: '', utc: '', offset: null },
      flag: null, isp: '', org: '', asn: '', domain: '', source: 'ipify',
    };
  }
  return {
    ...info,
    primary: info.ip || primary,
    ipv4: addresses.ipv4 || (isIPv4(primary) ? primary : null),
    ipv6: addresses.ipv6 || (isIPv6(primary) ? primary : null),
  };
}

/* ------------------------------------------------------------------ */
/* DNS over HTTPS                                                      */
/* ------------------------------------------------------------------ */

const RESOLVERS = {
  cloudflare: {
    name: 'Cloudflare',
    build: (name, type) => `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`,
    headers: { Accept: 'application/dns-json' },
  },
  google: {
    name: 'Google',
    build: (name, type) => `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`,
    headers: { Accept: 'application/dns-json' },
  },
};

function normalizeDns(data, { name, type, resolver, elapsedMs }) {
  const answers = (data.Answer || []).map((entry) => ({
    name: entry.name || name,
    type: entry.type,
    typeName: DNS_TYPES[entry.type] || String(entry.type),
    ttl: entry.TTL ?? null,
    data: entry.data ?? '',
  }));
  const authority = (data.Authority || []).map((entry) => ({
    name: entry.name || '',
    type: entry.type,
    typeName: DNS_TYPES[entry.type] || String(entry.type),
    ttl: entry.TTL ?? null,
    data: entry.data ?? '',
  }));
  return {
    name,
    type,
    resolver: resolver.name,
    resolverId: resolver.id,
    status: data.Status ?? -1,
    statusText: DNS_STATUS[data.Status] || `Status ${data.Status}`,
    truncated: Boolean(data.TC),
    answers,
    authority,
    elapsedMs,
  };
}

export async function dohQuery(rawName, type = 'A', resolverId = 'cloudflare') {
  let name = String(rawName ?? '').trim().replace(/^\[|\]$/g, '');
  if (!name) throw new ApiError('Enter a domain name or IP address.', 'invalid_input');
  if (type === 'PTR' && isIP(name)) name = reverseDnsName(name);
  name = name.replace(/\.$/, '');

  const order = [resolverId, resolverId === 'cloudflare' ? 'google' : 'cloudflare']
    .filter((id) => RESOLVERS[id]);
  let lastError;

  for (const id of order) {
    const resolver = { ...RESOLVERS[id], id };
    const started = performance.now();
    try {
      const data = await fetchJSON(resolver.build(name, type), {
        timeout: 9000,
        headers: resolver.headers,
      });
      const elapsedMs = Math.round(performance.now() - started);
      return normalizeDns(data, { name, type, resolver, elapsedMs });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new ApiError('DNS resolution failed.', 'dns_failed');
}

/* ------------------------------------------------------------------ */
/* RDAP                                                                */
/* ------------------------------------------------------------------ */

function vcardName(entity) {
  const card = entity?.vcardArray?.[1];
  if (!Array.isArray(card)) return '';
  for (const row of card) {
    if (Array.isArray(row) && row[0] === 'fn' && row[3]) return String(row[3]);
  }
  return '';
}

function collectEntities(list, accumulator = []) {
  for (const entity of list || []) {
    accumulator.push(entity);
    collectEntities(entity.entities, accumulator);
  }
  return accumulator;
}

function entityEmail(entity) {
  const card = entity?.vcardArray?.[1];
  if (!Array.isArray(card)) return '';
  for (const row of card) {
    if (Array.isArray(row) && row[0] === 'email' && row[3]) return String(row[3]);
  }
  return '';
}

export async function rdapLookup(kind, rawValue) {
  const value = String(rawValue ?? '').trim();
  if (!value) throw new ApiError('Enter a domain or IP address.', 'invalid_input');
  if (kind !== 'domain' && kind !== 'ip') throw new ApiError('Unsupported RDAP lookup.', 'invalid_input');

  const started = performance.now();
  const data = await fetchJSON(`https://rdap.org/${kind}/${encodeURIComponent(value)}`, { timeout: 15000 });
  const elapsedMs = Math.round(performance.now() - started);

  const events = {};
  for (const event of data.events || []) {
    if (event?.eventAction) events[String(event.eventAction).toLowerCase()] = event.eventDate || '';
  }

  const entities = collectEntities(data.entities);
  const registrarEntity = entities.find((entity) => (entity.roles || []).includes('registrar'))
    || entities.find((entity) => (entity.roles || []).includes('registrant'))
    || entities[0];
  const abuseEntity = entities.find((entity) => (entity.roles || []).includes('abuse'));

  const nameservers = (data.nameservers || [])
    .map((server) => server.ldhName || server.unicodeName)
    .filter(Boolean);

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
    registrarUrl: (registrarEntity?.links || []).find((link) => link.rel === 'about')?.href || '',
    abuseEmail: entityEmail(abuseEntity) || '',
    nameservers,
    dnssec: typeof secureDns.delegationSigned === 'boolean'
      ? (secureDns.delegationSigned ? 'Signed' : 'Unsigned')
      : null,
    startAddress: data.startAddress || '',
    endAddress: data.endAddress || '',
    country: data.country || '',
    type: data.type || '',
    ipVersion: data.ipVersion || '',
    range: data.startAddress && data.endAddress ? `${data.startAddress} – ${data.endAddress}` : '',
    selfLink: (data.links || []).find((link) => link.rel === 'self')?.href || '',
  };
}

/* ------------------------------------------------------------------ */
/* Optional inspector API                                              */
/* ------------------------------------------------------------------ */

function requireOnline(payload) {
  if (!payload || payload.ok !== true) {
    const message = payload?.error?.message || payload?.error || 'The inspector API returned an unexpected response.';
    throw new ApiError(String(message), payload?.error?.code || 'api_error', {
      hint: payload?.error?.hint || '',
    });
  }
  return payload;
}

let healthCache = { ts: 0, base: null, result: null };

export async function healthCheck({ timeout = 3200, force = false } = {}) {
  const base = getApiBase();
  if (!force && healthCache.result && healthCache.base === base && Date.now() - healthCache.ts < 15000) {
    return healthCache.result;
  }
  try {
    const data = await fetchJSON(apiUrl('/api/health'), { timeout });
    const online = Boolean(data && (data.ok === true || data.service === 'netscope'));
    const result = { online, base, data, error: online ? null : 'Unexpected health response.' };
    healthCache = { ts: Date.now(), base, result };
    return result;
  } catch (error) {
    const result = { online: false, base, data: null, error: error.message };
    healthCache = { ts: Date.now(), base, result };
    return result;
  }
}

export function invalidateHealthCache() {
  healthCache = { ts: 0, base: null, result: null };
}

export async function inspectWebsite(url) {
  const data = await fetchJSON(apiUrl(`/api/inspect?url=${encodeURIComponent(url)}`), { timeout: 30000 });
  return requireOnline(data);
}

export async function checkSMTP(host, port, mode = "auto") {
  const params = new URLSearchParams({ host, port: String(port), mode });
  const data = await fetchJSON(apiUrl(`/api/smtp?${params.toString()}`), { timeout: 30000 });
  return requireOnline(data);
}

export async function checkPort(host, port) {
  const data = await fetchJSON(
    apiUrl(`/api/port?host=${encodeURIComponent(host)}&port=${encodeURIComponent(port)}`),
    { timeout: 12000 },
  );
  return requireOnline(data);
}

export async function serverDns(name, type) {
  const data = await fetchJSON(
    apiUrl(`/api/dns?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`),
    { timeout: 12000 },
  );
  return requireOnline(data);
}

export { DNS_TYPES, DNS_STATUS };
