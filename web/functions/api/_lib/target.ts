/**
 * Target validation: URL parsing plus public-host resolution.
 *
 * Every outbound connection in the API goes through `resolvePublicHost` /
 * `validatePublicUrl` first so that loopback, private, link-local, CGNAT,
 * multicast and reserved destinations are refused (SSRF protection).
 */

import { ApiError, blockedHost } from './errors';
import { resolveAddresses } from './doh';
import { isIP, isPublicIP, parseIPv4, parseIPv6 } from './ip';

export const MAX_URL_LENGTH = 2048;
export const MAX_REDIRECTS = 5;

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata',
  'metadata.google.internal',
  'instance-data',
  '169.254.169.254',
]);

const BLOCKED_SUFFIXES = ['.local', '.internal', '.localhost', '.home.arpa', '.localdomain'];

const PRIVATE_HINT = 'NetScope only inspects public internet resources.';

export interface ResolvedHost {
  /** Host as supplied (lower-cased, brackets/zone/trailing dot removed). */
  host: string;
  /** Punycode/ASCII form used for DNS, SNI and certificate matching. */
  ascii: string;
  addresses: string[];
}

function normalizeHost(input: string): string {
  return input
    .trim()
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .split('%')[0]
    .replace(/\.$/, '')
    .toLowerCase();
}

function blockedName(host: string): boolean {
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  return BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

function requirePublicAddress(address: string): void {
  if (!isIP(address)) {
    throw new ApiError('invalid_host', 'The host did not resolve to a valid IP address.');
  }
  if (!isPublicIP(address)) {
    throw blockedHost('Private, loopback, link-local and reserved addresses are not allowed.', PRIVATE_HINT);
  }
}

function toAsciiHost(host: string): string {
  try {
    const parsed = new URL(`http://${host}/`);
    return parsed.hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  } catch {
    throw new ApiError('invalid_host', 'The hostname could not be converted to ASCII.');
  }
}

/**
 * Resolve a hostname (or validate an IP literal) and ensure every address is
 * publicly routable. Mirrors `resolve_public_host` in pyapp/app.py.
 */
export async function resolvePublicHost(rawHost: string, port = 443, timeoutMs = 4000): Promise<ResolvedHost> {
  const host = normalizeHost(rawHost);
  if (!host) throw new ApiError('invalid_host', 'Enter a hostname or IP address.');
  if (blockedName(host)) throw blockedHost('That hostname is not allowed.');

  const literal = parseIPv4(host) !== null || parseIPv6(host) !== null;
  if (literal) {
    requirePublicAddress(host);
    return { host, ascii: host, addresses: [host] };
  }

  // Bare single-label names are never public internet resources.
  if (!host.includes('.')) {
    throw blockedHost('Bare hostnames without a domain suffix are not allowed.');
  }

  const ascii = toAsciiHost(host);
  if (blockedName(ascii)) throw blockedHost('That hostname is not allowed.');

  // A URL parser may normalise numeric-looking hosts (octal, integer) into an
  // IPv4 literal; re-check after conversion so those cannot slip through.
  if (isIP(ascii)) {
    requirePublicAddress(ascii);
    return { host, ascii, addresses: [ascii] };
  }

  const resolved = await resolveAddresses(ascii, timeoutMs);
  if (resolved.addresses.length === 0) {
    if (resolved.timedOut) {
      throw new ApiError('dns_timeout', 'DNS resolution timed out.', 504);
    }
    throw new ApiError('dns_error', `Could not resolve ${host}.`, 422);
  }
  for (const address of resolved.addresses) requirePublicAddress(address);
  void port;
  return { host, ascii, addresses: resolved.addresses };
}

/**
 * Validate an inspectable URL and return its normalised form (fragment
 * removed). Mirrors `validate_public_url` in pyapp/app.py.
 */
export async function validatePublicUrl(raw: string): Promise<string> {
  if (!raw || raw.length > MAX_URL_LENGTH) {
    throw new ApiError('invalid_url', 'Enter a URL shorter than 2048 characters.');
  }
  const candidate = raw.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(candidate) ? candidate : `https://${candidate}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    const portMatch = /:\/\/[^/?#]*:(\d+)(?:[/?#]|$)/.exec(withScheme);
    if (portMatch && (Number(portMatch[1]) < 1 || Number(portMatch[1]) > 65535)) {
      throw new ApiError('invalid_url', 'The port must be between 1 and 65535.');
    }
    throw new ApiError('invalid_url', 'The URL could not be parsed.');
  }

  const scheme = parsed.protocol.replace(/:$/, '').toLowerCase();
  if (scheme !== 'http' && scheme !== 'https') {
    throw new ApiError('invalid_scheme', 'Only http:// and https:// URLs can be inspected.');
  }
  if (!parsed.hostname) {
    throw new ApiError('invalid_url', 'The URL is missing a hostname.');
  }
  if (parsed.username || parsed.password) {
    throw new ApiError('invalid_url', 'URLs with embedded credentials are not allowed.');
  }

  const explicitPort = parsed.port ? Number(parsed.port) : undefined;
  if (explicitPort !== undefined && (!Number.isInteger(explicitPort) || explicitPort < 1 || explicitPort > 65535)) {
    throw new ApiError('invalid_url', 'The port must be between 1 and 65535.');
  }

  await resolvePublicHost(parsed.hostname, explicitPort ?? 443);

  parsed.hash = '';
  return parsed.href;
}
