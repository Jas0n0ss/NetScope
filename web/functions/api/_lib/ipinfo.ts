/** Public IP discovery for `GET /api/ip` and `GET /ip`. */

import { ipFamily, isPublicIP } from './ip';

const USER_AGENT = 'NetScope/2.1 (+https://github.com/Jas0n0ss/lsp)';

export type IpSource = 'client' | 'server-egress' | 'client-private';

export interface IpPayload {
  ok: true;
  ip: string;
  family: 'IPv4' | 'IPv6';
  source: IpSource;
}

/** Cloudflare sets `cf-connecting-ip`; X-Forwarded-For is a local-dev fallback. */
export function clientIp(request: Request): string {
  const connecting = request.headers.get('cf-connecting-ip');
  if (connecting && connecting.trim()) return connecting.trim();
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0].trim();
    if (first) return first;
  }
  return 'unknown';
}

export async function publicIpPayload(request: Request): Promise<IpPayload> {
  let address = clientIp(request);
  let source: IpSource = 'client';

  if (!isPublicIP(address)) {
    try {
      const response = await fetch('https://api.ipify.org?format=json', {
        headers: { accept: 'application/json', 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { ip?: unknown };
      const echoed = typeof data?.ip === 'string' ? data.ip.trim() : '';
      if (!echoed) throw new Error('empty response');
      address = echoed;
      source = 'server-egress';
    } catch {
      // Keep the original (private) address so the UI can still show it.
      source = 'client-private';
    }
  }

  return {
    ok: true,
    ip: address,
    family: ipFamily(address),
    source,
  };
}
