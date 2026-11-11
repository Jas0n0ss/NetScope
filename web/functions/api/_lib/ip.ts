/**
 * IP address parsing and public-range checks.
 *
 * Anything that is not globally routable must be rejected before an outbound
 * connection is attempted (SSRF protection). The ranges below cover IPv4 and
 * IPv6, including IPv4-mapped IPv6, NAT64 and 6to4 embeddings.
 */

export function stripZone(value: string): string {
  return value.split('%')[0].trim();
}

export function parseIPv4(value: string): number | null {
  const text = stripZone(value);
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (!match) return null;
  let result = 0;
  for (let index = 1; index <= 4; index += 1) {
    const part = Number(match[index]);
    if (!Number.isInteger(part) || part < 0 || part > 255) return null;
    // Reject leading zeros: URL parsers may interpret them as octal.
    if (match[index].length > 1 && match[index].startsWith('0')) return null;
    result = result * 256 + part;
  }
  return result >>> 0;
}

export function formatIPv4(value: number): string {
  return [24, 16, 8, 0].map((shift) => Math.floor(value / 2 ** shift) % 256).join('.');
}

const IPV4_BLOCKS: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

function ipv4Blocked(address: number): boolean {
  for (const [base, bits] of IPV4_BLOCKS) {
    const baseValue = parseIPv4(base);
    if (baseValue === null) continue;
    const size = 2 ** (32 - bits);
    const start = Math.floor(baseValue / size) * size;
    if (address >= start && address < start + size) return true;
  }
  return false;
}

export function isPublicIPv4(address: number): boolean {
  return !ipv4Blocked(address);
}

/** Parse an IPv6 literal (with or without brackets / zone) into 8 hextets. */
export function parseIPv6(value: string): number[] | null {
  let text = stripZone(value).replace(/^\[/, '').replace(/\]$/, '');
  if (!text.includes(':')) return null;

  const halves = text.split('::');
  if (halves.length > 2) return null;
  const compressed = halves.length === 2;

  const expandIPv4Tail = (groups: string[]): string[] | null => {
    if (groups.length === 0) return groups;
    const last = groups[groups.length - 1];
    if (!last.includes('.')) return groups;
    const v4 = parseIPv4(last);
    if (v4 === null) return null;
    return [...groups.slice(0, -1), ((v4 >>> 16) & 0xffff).toString(16), (v4 & 0xffff).toString(16)];
  };

  const headRaw = halves[0] ? halves[0].split(':') : [];
  const tailRaw = compressed && halves[1] ? halves[1].split(':') : [];
  if (!compressed && halves.length === 1 && text.endsWith(':')) return null;

  const head = expandIPv4Tail(headRaw);
  const tail = expandIPv4Tail(tailRaw);
  if (head === null || tail === null) return null;
  if (head.some((group) => group === '') || tail.some((group) => group === '')) return null;
  if (head.length + tail.length > 8) return null;

  const missing = 8 - head.length - tail.length;
  if (compressed) {
    if (missing < 1) return null;
  } else if (missing !== 0) {
    return null;
  }

  const groups = [...head, ...new Array<string>(missing).fill('0'), ...tail];
  if (groups.length !== 8) return null;
  const parsed: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
    parsed.push(parseInt(group, 16));
  }
  return parsed;
}

export function isPublicIPv6(groups: number[]): boolean {
  if (groups.length !== 8) return false;
  const allZero = groups.every((group) => group === 0);
  if (allZero) return false; // ::
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return false; // ::1

  const first = groups[0];
  const second = groups[1];

  // fc00::/7 unique local
  if ((first & 0xfe00) === 0xfc00) return false;
  // fe80::/10 link local
  if ((first & 0xffc0) === 0xfe80) return false;
  // ff00::/8 multicast
  if ((first & 0xff00) === 0xff00) return false;
  // 2001:db8::/32 documentation
  if (first === 0x2001 && second === 0x0db8) return false;
  // 2001::/23 IETF protocol assignments (Teredo, ORCHID, benchmarking...)
  if (first === 0x2001 && (second & 0xfe00) === 0x0000) return false;
  // 2002::/16 6to4 (can embed private IPv4)
  if (first === 0x2002) return false;
  // 100::/64 discard-only
  if (first === 0x0100 && second === 0 && groups[2] === 0 && groups[3] === 0) return false;
  // 3fff::/20 documentation
  if (first === 0x3fff && (second & 0xf000) === 0x0000) return false;

  // 64:ff9b::/96 well-known NAT64: validate the embedded IPv4 address.
  if (first === 0x0064 && second === 0xff9b && groups[2] === 0 && groups[3] === 0 && groups[4] === 0 && groups[5] === 0) {
    return isPublicIPv4(((groups[6] << 16) | groups[7]) >>> 0);
  }
  // 64:ff9b:1::/48 local-use NAT64
  if (first === 0x0064 && second === 0xff9b && groups[2] === 1) {
    return false;
  }
  // ::ffff:0:0/96 IPv4-mapped IPv6: validate the embedded IPv4 address.
  if (first === 0 && second === 0 && groups[2] === 0 && groups[3] === 0 && groups[4] === 0 && groups[5] === 0xffff) {
    return isPublicIPv4(((groups[6] << 16) | groups[7]) >>> 0);
  }
  // ::/96 IPv4-compatible (deprecated) and the unspecified range.
  if (first === 0 && second === 0 && groups[2] === 0 && groups[3] === 0 && groups[4] === 0 && groups[5] === 0) {
    return false;
  }

  return true;
}

export function isIP(value: string): boolean {
  return parseIPv4(value) !== null || parseIPv6(value) !== null;
}

export function isPublicIP(value: string): boolean {
  const v4 = parseIPv4(value);
  if (v4 !== null) return isPublicIPv4(v4);
  const v6 = parseIPv6(value);
  if (v6 !== null) return isPublicIPv6(v6);
  return false;
}

export function ipFamily(value: string): 'IPv4' | 'IPv6' {
  return stripZone(value).includes(':') ? 'IPv6' : 'IPv4';
}

/** Build the in-addr.arpa / ip6.arpa name used for PTR lookups. */
export function reversePointer(value: string): string | null {
  const v4 = parseIPv4(value);
  if (v4 !== null) {
    return `${formatIPv4(v4).split('.').reverse().join('.')}.in-addr.arpa`;
  }
  const v6 = parseIPv6(value);
  if (v6 !== null) {
    const nibbles = v6.map((group) => group.toString(16).padStart(4, '0')).join('');
    return `${nibbles.split('').reverse().join('.')}.ip6.arpa`;
  }
  return null;
}
