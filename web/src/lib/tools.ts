/**
 * Pure network math — no DOM, no network I/O.
 */

import type { AuditCheck, HeaderAudit } from './types';

export const isIPv4 = (value: unknown): boolean => {
  const parts = String(value ?? '').trim().split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255);
};

export const parseIPv4 = (value: unknown): number[] | null =>
  isIPv4(value) ? String(value).trim().split('.').map(Number) : null;

export function ipv4ToInt(value: unknown): number | null {
  const parts = parseIPv4(value);
  if (!parts) return null;
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

export function intToIPv4(value: number | string): string | null {
  const int = Number(value);
  if (!Number.isFinite(int) || int < 0 || int > 0xffffffff) return null;
  const unsigned = int >>> 0;
  return [
    (unsigned >>> 24) & 255,
    (unsigned >>> 16) & 255,
    (unsigned >>> 8) & 255,
    unsigned & 255,
  ].join('.');
}

export function ipv4Class(value: unknown): string | null {
  const parts = parseIPv4(value);
  if (!parts) return null;
  const first = parts[0];
  if (first === 0) return 'This network';
  if (first < 128) return 'Class A';
  if (first < 192) return 'Class B';
  if (first < 224) return 'Class C';
  if (first < 240) return 'Class D (multicast)';
  return 'Class E (reserved)';
}

const PRIVATE_RANGES: [string, number, string][] = [
  ['10.0.0.0', 8, 'Private (RFC 1918)'],
  ['172.16.0.0', 12, 'Private (RFC 1918)'],
  ['192.168.0.0', 16, 'Private (RFC 1918)'],
  ['127.0.0.0', 8, 'Loopback'],
  ['169.254.0.0', 16, 'Link-local'],
  ['100.64.0.0', 10, 'Carrier-grade NAT'],
  ['192.0.2.0', 24, 'Documentation'],
  ['198.51.100.0', 24, 'Documentation'],
  ['203.0.113.0', 24, 'Documentation'],
  ['198.18.0.0', 15, 'Benchmarking'],
  ['224.0.0.0', 4, 'Multicast'],
  ['240.0.0.0', 4, 'Reserved'],
  ['0.0.0.0', 8, 'This network'],
];

export function ipv4Scope(value: unknown): string | null {
  const int = ipv4ToInt(value);
  if (int === null) return null;
  if (int === 0xffffffff) return 'Limited broadcast';
  for (const [network, prefix, label] of PRIVATE_RANGES) {
    const base = ipv4ToInt(network) as number;
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    if (((int & mask) >>> 0) === ((base & mask) >>> 0)) return label;
  }
  return 'Public';
}

/* ------------------------------- IPv6 -------------------------------- */

export function parseIPv6(value: unknown): number[] | null {
  let text = String(value ?? '').trim().toLowerCase();
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
  if (!text.includes(':')) return null;

  if (text.includes('.')) {
    const lastColon = text.lastIndexOf(':');
    const v4 = text.slice(lastColon + 1);
    if (!isIPv4(v4)) return null;
    const parts = parseIPv4(v4) as number[];
    text = `${text.slice(0, lastColon + 1)}${((parts[0] << 8) | parts[1]).toString(16)}:${((parts[2] << 8) | parts[3]).toString(16)}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;

  let groups: string[];
  if (halves.length === 2) {
    const left = halves[0] ? halves[0].split(':') : [];
    const right = halves[1] ? halves[1].split(':') : [];
    const missing = 8 - left.length - right.length;
    if (missing < 1) return null;
    groups = [...left, ...Array(missing).fill('0'), ...right];
  } else {
    groups = text.split(':');
    if (groups.length !== 8) return null;
  }

  if (groups.length !== 8) return null;
  const parsed: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    parsed.push(parseInt(group, 16));
  }
  return parsed;
}

export const isIPv6 = (value: unknown): boolean => parseIPv6(value) !== null;

export const isIP = (value: unknown): boolean => isIPv4(value) || isIPv6(value);

export function formatIPv6(groups: number[], { compress = true } = {}): string {
  if (!Array.isArray(groups) || groups.length !== 8) return '';
  const hex = groups.map((group) => (group & 0xffff).toString(16));
  if (!compress) return hex.map((group) => group.padStart(4, '0')).join(':');

  let bestStart = -1;
  let bestLength = 0;
  for (let index = 0; index < 8; ) {
    if (groups[index] === 0) {
      let end = index;
      while (end < 8 && groups[end] === 0) end += 1;
      if (end - index > bestLength && end - index >= 2) {
        bestStart = index;
        bestLength = end - index;
      }
      index = end;
    } else {
      index += 1;
    }
  }

  if (bestStart === -1) return hex.join(':');
  const left = hex.slice(0, bestStart).join(':');
  const right = hex.slice(bestStart + bestLength).join(':');
  return `${left}::${right}`;
}

export const expandIPv6 = (groups: number[]): string => formatIPv6(groups, { compress: false });

export function ipv6Type(groups: number[]): string | null {
  if (!Array.isArray(groups) || groups.length !== 8) return null;
  if (groups.every((group) => group === 0)) return 'Unspecified';
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return 'Loopback';
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) return 'IPv4-mapped';
  if (groups.slice(0, 6).every((group) => group === 0)) return 'IPv4-compatible (deprecated)';
  if ((groups[0] & 0xffc0) === 0xfe80) return 'Link-local';
  if ((groups[0] & 0xfe00) === 0xfc00) return 'Unique local';
  if ((groups[0] & 0xff00) === 0xff00) return 'Multicast';
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) return 'Documentation';
  if (groups[0] === 0x0064 && groups[1] === 0xff9b) return 'NAT64';
  if ((groups[0] & 0xe000) === 0x2000) return 'Global unicast';
  return 'Reserved';
}

export function ipv6Subnet(groups: number[], prefix: number): { network: number[]; last: number[] } {
  const network = groups.slice();
  const last = groups.slice();
  for (let index = 0; index < 8; index += 1) {
    const bits = Math.max(0, Math.min(16, prefix - index * 16));
    const mask = bits === 0 ? 0 : ((0xffff << (16 - bits)) & 0xffff);
    const hostMask = bits === 16 ? 0 : (0xffff >>> bits);
    network[index] = groups[index] & mask;
    last[index] = groups[index] | hostMask;
  }
  return { network, last };
}

export function ipv6ToIpv4(groups: number[]): string | null {
  if (!Array.isArray(groups) || groups.length !== 8) return null;
  if (!(groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff)) return null;
  return `${(groups[6] >> 8) & 255}.${groups[6] & 255}.${(groups[7] >> 8) & 255}.${groups[7] & 255}`;
}

/* ------------------------------- rows -------------------------------- */

export type InfoRow = { label: string; value: string; mono?: boolean; emphasis?: boolean; full?: boolean };

export type LookupBlock =
  | { error: string }
  | {
      error?: undefined;
      version: 4 | 6;
      title?: string;
      summary?: string;
      note?: string;
      rows: InfoRow[];
    };

const nf = new Intl.NumberFormat('en-US');

export function subnetInfo(input: string): LookupBlock {
  const raw = String(input ?? '').trim();
  if (!raw) return { error: 'Enter a CIDR block, for example 192.168.1.10/24.' };

  const slash = raw.indexOf('/');
  const address = slash === -1 ? raw : raw.slice(0, slash);
  const prefixRaw = slash === -1 ? null : raw.slice(slash + 1);

  if (isIPv4(address)) {
    const prefix = prefixRaw === null || prefixRaw === '' ? 32 : Number(prefixRaw);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
      return { error: 'IPv4 prefix length must be an integer between 0 and 32.' };
    }
    const ipInt = ipv4ToInt(address) as number;
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    const network = (ipInt & mask) >>> 0;
    const broadcast = (network | (~mask >>> 0)) >>> 0;
    const total = 2 ** (32 - prefix);
    const hosts = prefix === 32 ? 1 : prefix === 31 ? 2 : total - 2;
    const first = prefix >= 31 ? network : network + 1;
    const last = prefix >= 31 ? broadcast : broadcast - 1;
    const binaryMask = mask.toString(2).padStart(32, '0').match(/.{8}/g)!.join('.');

    return {
      version: 4,
      summary: `${intToIPv4(network)}/${prefix}`,
      note:
        prefix === 31
          ? 'A /31 is a point-to-point link with two usable addresses.'
          : prefix === 32
            ? 'A /32 represents a single host address.'
            : `${nf.format(hosts)} usable host addresses.`,
      rows: [
        { label: 'Network', value: intToIPv4(network) as string, mono: true, emphasis: true },
        { label: 'Broadcast', value: intToIPv4(broadcast) as string, mono: true },
        { label: 'Subnet mask', value: intToIPv4(mask) as string, mono: true },
        { label: 'Wildcard', value: intToIPv4(~mask >>> 0) as string, mono: true },
        { label: 'Usable range', value: `${intToIPv4(first)} – ${intToIPv4(last)}`, mono: true },
        { label: 'Usable hosts', value: nf.format(hosts) },
        { label: 'Total addresses', value: nf.format(total) },
        { label: 'Prefix', value: `/${prefix}` },
        { label: 'Class', value: ipv4Class(address) as string },
        { label: 'Scope', value: ipv4Scope(intToIPv4(network) as string) as string },
        { label: 'Binary mask', value: binaryMask, mono: true, full: true },
        { label: 'Reverse DNS', value: reverseDnsName(address) as string, mono: true, full: true },
      ],
    };
  }

  if (isIPv6(address)) {
    const prefix = prefixRaw === null || prefixRaw === '' ? 128 : Number(prefixRaw);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128) {
      return { error: 'IPv6 prefix length must be an integer between 0 and 128.' };
    }
    const groups = parseIPv6(address) as number[];
    const { network, last } = ipv6Subnet(groups, prefix);
    const total = 1n << BigInt(128 - prefix);
    const mapped = ipv6ToIpv4(network);

    return {
      version: 6,
      summary: `${formatIPv6(network)}/${prefix}`,
      note:
        prefix === 128
          ? 'A /128 identifies a single IPv6 address.'
          : `2^${128 - prefix} total addresses in this prefix.`,
      rows: [
        { label: 'Network', value: `${formatIPv6(network)}/${prefix}`, mono: true, emphasis: true },
        { label: 'First address', value: formatIPv6(network), mono: true },
        { label: 'Last address', value: formatIPv6(last), mono: true },
        { label: 'Prefix length', value: `/${prefix}` },
        { label: 'Host bits', value: String(128 - prefix) },
        {
          label: 'Addresses',
          value: total > 1000000n ? `2^${128 - prefix}` : nf.format(total),
        },
        { label: 'Type', value: ipv6Type(network) as string },
        { label: 'Expanded', value: expandIPv6(network), mono: true, full: true },
        ...(mapped ? [{ label: 'Mapped IPv4', value: mapped, mono: true }] : []),
      ],
    };
  }

  return { error: 'That does not look like an IPv4 or IPv6 address. Try 10.0.0.0/8 or 2001:db8::/32.' };
}

export function reverseDnsName(ip: string): string | null {
  if (isIPv4(ip)) return `${String(ip).trim().split('.').reverse().join('.')}.in-addr.arpa`;
  if (isIPv6(ip)) {
    const groups = parseIPv6(ip) as number[];
    const nibbles = groups.map((group) => group.toString(16).padStart(4, '0')).join('');
    return `${nibbles.split('').reverse().join('.')}.ip6.arpa`;
  }
  return null;
}

export function ipConvert(input: string): LookupBlock {
  const raw = String(input ?? '').trim();
  if (!raw) return { error: 'Enter an IP address or a 32-bit integer.' };

  if (isIPv4(raw)) {
    const int = ipv4ToInt(raw) as number;
    return {
      version: 4,
      title: raw,
      rows: [
        { label: 'Dotted decimal', value: raw, mono: true, emphasis: true },
        { label: 'Decimal', value: String(int), mono: true },
        { label: 'Hexadecimal', value: `0x${int.toString(16).toUpperCase().padStart(8, '0')}`, mono: true },
        { label: 'Binary', value: int.toString(2).padStart(32, '0').match(/.{8}/g)!.join('.'), mono: true, full: true },
        { label: 'IPv6-mapped', value: `::ffff:${raw}`, mono: true },
        { label: 'Reverse DNS', value: reverseDnsName(raw) as string, mono: true, full: true },
      ],
    };
  }

  if (/^\d+$/.test(raw) || /^0x[0-9a-f]+$/i.test(raw)) {
    const int = /^0x/i.test(raw) ? Number.parseInt(raw.slice(2), 16) : Number(raw);
    const ipv4 = intToIPv4(int);
    if (!ipv4) return { error: 'That integer is outside the 32-bit IPv4 range (0 – 4294967295).' };
    return {
      version: 4,
      title: ipv4,
      rows: [
        { label: 'Dotted decimal', value: ipv4, mono: true, emphasis: true },
        { label: 'Decimal', value: String(int), mono: true },
        { label: 'Hexadecimal', value: `0x${(int >>> 0).toString(16).toUpperCase().padStart(8, '0')}`, mono: true },
        { label: 'Binary', value: (int >>> 0).toString(2).padStart(32, '0').match(/.{8}/g)!.join('.'), mono: true, full: true },
        { label: 'IPv6-mapped', value: `::ffff:${ipv4}`, mono: true },
      ],
    };
  }

  if (isIPv6(raw)) {
    const groups = parseIPv6(raw) as number[];
    const { network } = ipv6Subnet(groups, 64);
    const mapped = ipv6ToIpv4(groups);
    return {
      version: 6,
      title: formatIPv6(groups),
      rows: [
        { label: 'Compressed', value: formatIPv6(groups), mono: true, emphasis: true },
        { label: 'Expanded', value: expandIPv6(groups), mono: true, full: true },
        { label: 'Type', value: ipv6Type(groups) as string },
        { label: '/64 network', value: `${formatIPv6(network)}/64`, mono: true },
        { label: 'Reverse DNS', value: reverseDnsName(raw) as string, mono: true, full: true },
        ...(mapped ? [{ label: 'Mapped IPv4', value: mapped, mono: true }] : []),
      ],
    };
  }

  return { error: 'Enter a valid IPv4/IPv6 address, decimal integer or 0x-prefixed hex value.' };
}

export type UrlInfo = {
  url: string;
  params: { key: string; value: string }[];
  rows: InfoRow[];
  warnings: string[];
  flags: { https: boolean; credentials: boolean; ipHost: boolean; punycode: boolean };
};

export function parseUrlInfo(input: string): UrlInfo | { error: string } {
  let raw = String(input ?? '').trim();
  if (!raw) return { error: 'Paste a URL to inspect its components.' };
  let addedScheme = false;
  if (!/^[a-z][a-z\d+.-]*:/i.test(raw)) {
    raw = `https://${raw}`;
    addedScheme = true;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { error: 'That is not a parseable URL.' };
  }

  const params: { key: string; value: string }[] = [];
  url.searchParams.forEach((value, key) => params.push({ key, value }));

  const rows: InfoRow[] = [
    { label: 'Protocol', value: url.protocol.replace(':', ''), mono: true, emphasis: true },
    { label: 'Hostname', value: url.hostname, mono: true },
    {
      label: 'Port',
      value: url.port || (url.protocol === 'https:' ? '443 (default)' : url.protocol === 'http:' ? '80 (default)' : '—'),
      mono: true,
    },
    { label: 'Pathname', value: url.pathname || '/', mono: true, full: true },
    { label: 'Origin', value: url.origin, mono: true, full: true },
    { label: 'Hash', value: url.hash || '—', mono: true },
    { label: 'Query string', value: url.search || '—', mono: true, full: true },
  ];

  const warnings: string[] = [];
  if (url.protocol === 'http:') warnings.push('Plain HTTP — traffic is not encrypted in transit.');
  if (url.username || url.password) warnings.push('The URL embeds credentials, which are visible in logs and history.');
  if (url.hostname.includes('xn--')) warnings.push('Punycode hostname — verify the Unicode form before trusting it.');
  if (isIPv4(url.hostname) || url.hostname.includes(':')) warnings.push('Host is a raw IP address rather than a domain name.');
  if (url.href.length > 2000) warnings.push('URL is longer than 2000 characters; some servers and proxies truncate it.');
  if (params.length > 20) warnings.push(`${params.length} query parameters — unusual and potentially abusive.`);
  if (addedScheme) warnings.unshift('No scheme was supplied, so https:// was assumed.');

  return {
    url: url.href,
    params,
    rows,
    warnings,
    flags: {
      https: url.protocol === 'https:',
      credentials: Boolean(url.username || url.password),
      ipHost: isIPv4(url.hostname) || url.hostname.includes(':'),
      punycode: url.hostname.includes('xn--'),
    },
  };
}

function headerValue(headers: Record<string, unknown> | null | undefined, name: string): string {
  if (!headers || typeof headers !== 'object') return '';
  const key = Object.keys(headers).find((entry) => entry.toLowerCase() === name);
  if (!key) return '';
  const value = headers[key];
  return Array.isArray(value) ? value.join(', ') : String(value ?? '');
}

export function auditHeaders(
  headers: Record<string, unknown>,
  { https = true }: { https?: boolean } = {},
): HeaderAudit {
  const csp = headerValue(headers, 'content-security-policy');
  const xfo = headerValue(headers, 'x-frame-options');
  const checks: AuditCheck[] = [
    {
      id: 'strict-transport-security',
      name: 'Strict-Transport-Security',
      status: https ? (headerValue(headers, 'strict-transport-security') ? 'pass' : 'fail') : 'warn',
      detail: https
        ? headerValue(headers, 'strict-transport-security') || 'Missing — HTTPS is not enforced for repeat visits.'
        : 'No HSTS over plain HTTP (expected).',
      weight: 1,
    },
    {
      id: 'content-security-policy',
      name: 'Content-Security-Policy',
      status: csp ? 'pass' : 'fail',
      detail: csp ? `Present · ${csp.length} characters` : 'Missing — no defense-in-depth against injected scripts.',
      weight: 1,
    },
    {
      id: 'x-content-type-options',
      name: 'X-Content-Type-Options',
      status: /nosniff/i.test(headerValue(headers, 'x-content-type-options')) ? 'pass' : 'fail',
      detail: /nosniff/i.test(headerValue(headers, 'x-content-type-options'))
        ? 'nosniff'
        : 'Missing — MIME sniffing is allowed.',
      weight: 1,
    },
    {
      id: 'frame-ancestors',
      name: 'Clickjacking protection',
      status: /^(deny|sameorigin)$/i.test(xfo.trim()) || /frame-ancestors/i.test(csp) ? 'pass' : 'fail',
      detail: /frame-ancestors/i.test(csp)
        ? 'Covered by CSP frame-ancestors'
        : xfo || 'Missing — the page can be framed by third parties.',
      weight: 1,
    },
    {
      id: 'referrer-policy',
      name: 'Referrer-Policy',
      status: headerValue(headers, 'referrer-policy') ? 'pass' : 'fail',
      detail: headerValue(headers, 'referrer-policy') || 'Missing — full URLs may leak to third parties.',
      weight: 1,
    },
    {
      id: 'permissions-policy',
      name: 'Permissions-Policy',
      status: headerValue(headers, 'permissions-policy') ? 'pass' : 'fail',
      detail: headerValue(headers, 'permissions-policy')
        ? 'Present'
        : 'Missing — powerful browser features are unrestricted.',
      weight: 1,
    },
    {
      id: 'cross-origin-opener-policy',
      name: 'Cross-Origin-Opener-Policy',
      status: headerValue(headers, 'cross-origin-opener-policy') ? 'pass' : 'fail',
      detail: headerValue(headers, 'cross-origin-opener-policy') || 'Missing — cross-origin isolation is weaker.',
      weight: 1,
    },
    {
      id: 'cross-origin-resource-policy',
      name: 'Cross-Origin-Resource-Policy',
      status: headerValue(headers, 'cross-origin-resource-policy') ? 'pass' : 'fail',
      detail: headerValue(headers, 'cross-origin-resource-policy') || 'Missing — resources can be embedded cross-origin.',
      weight: 1,
    },
  ];

  const passed = checks.filter((check) => check.status === 'pass').length;
  const score = Math.round((passed / checks.length) * 100);
  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';

  const observations: HeaderAudit['observations'] = [];
  const server = headerValue(headers, 'server');
  const poweredBy = headerValue(headers, 'x-powered-by');
  if (server) observations.push({ tone: 'info', text: `Server header reveals “${server}”.` });
  if (poweredBy) observations.push({ tone: 'warn', text: `X-Powered-By reveals “${poweredBy}”.` });
  const cookies = headerValue(headers, 'set-cookie');
  if (cookies && !/secure/i.test(cookies)) observations.push({ tone: 'warn', text: 'A cookie is set without the Secure attribute.' });
  if (!headerValue(headers, 'cache-control')) observations.push({ tone: 'info', text: 'No Cache-Control header was provided.' });

  return { checks, passed, total: checks.length, score, grade, observations };
}

export function parseUserAgent(userAgent = navigator.userAgent) {
  const ua = String(userAgent);
  let browser = 'Unknown';
  let browserVersion = '';
  const patterns: [string, RegExp][] = [
    ['Edge', /Edg(?:e|A|iOS)?\/([\d.]+)/],
    ['Opera', /(?:OPR|OPiOS)\/([\d.]+)/],
    ['Samsung Internet', /SamsungBrowser\/([\d.]+)/],
    ['Firefox', /(?:Firefox|FxiOS)\/([\d.]+)/],
    ['Chrome', /(?:Chrome|CriOS)\/([\d.]+)/],
    ['Safari', /Version\/([\d.]+).*Safari/],
  ];
  for (const [name, pattern] of patterns) {
    const match = ua.match(pattern);
    if (match) {
      browser = name;
      browserVersion = match[1];
      break;
    }
  }

  let os = 'Unknown';
  let osVersion = '';
  if (/Windows NT 10\.0/.test(ua)) os = 'Windows 10 / 11';
  else if (/Windows NT 6\.3/.test(ua)) os = 'Windows 8.1';
  else if (/Windows NT 6\.1/.test(ua)) os = 'Windows 7';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Android ([\d.]+)/.test(ua)) {
    os = 'Android';
    osVersion = ua.match(/Android ([\d.]+)/)![1];
  } else if (/(?:iPhone|iPad|iPod).*OS ([\d_]+)/.test(ua)) {
    os = /iPad/.test(ua) ? 'iPadOS' : 'iOS';
    osVersion = ua.match(/OS ([\d_]+)/)![1].replaceAll('_', '.');
  } else if (/Mac OS X ([\d_]+)/.test(ua)) {
    os = 'macOS';
    osVersion = ua.match(/Mac OS X ([\d_]+)/)![1].replaceAll('_', '.');
  } else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Linux/.test(ua)) os = 'Linux';

  let engine = 'Unknown';
  if (/AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg/.test(ua)) engine = 'WebKit';
  if (/Chrome|Chromium|Edg/.test(ua)) engine = 'Blink';
  if (/Gecko\//.test(ua) && !/like Gecko/.test(ua)) engine = 'Gecko';

  const mobile = /Mobi|Android|iPhone|iPod/.test(ua);
  const tablet = /iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobi/.test(ua));
  const deviceType = tablet ? 'Tablet' : mobile ? 'Mobile' : 'Desktop';

  return { browser, browserVersion, os, osVersion, engine, deviceType };
}
