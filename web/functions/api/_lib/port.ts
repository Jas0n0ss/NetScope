/** Single TCP port reachability probe using `cloudflare:sockets`. */

import { connect, type Socket } from 'cloudflare:sockets';
import { ApiError } from './errors';
import { resolvePublicHost } from './target';
import { errorMessage, isTimeoutError, withTimeout } from './util';

const PORT_TIMEOUT_MS = 4000;

function connectionError(error: unknown): string {
  if (isTimeoutError(error)) return 'Connection timed out.';
  const message = errorMessage(error).trim();
  if (/refused/i.test(message)) return 'Connection refused.';
  if (/proxy request failed|cannot connect to the specified address/i.test(message)) {
    return 'Cloudflare Workers cannot reach Cloudflare-owned IP ranges over TCP. Try a host that is not proxied by Cloudflare.';
  }
  if (/timed?\s?out|timeout/i.test(message)) return 'Connection timed out.';
  return message || 'Connection failed.';
}

/**
 * `socket.close()` can wait for a still-pending TCP connect, so bound it: the
 * response must not hang on a blackholed port.
 */
export async function closeSocket(socket: Socket | null): Promise<void> {
  if (!socket) return;
  try {
    await withTimeout(socket.close(), 500, 'Socket close timed out.');
  } catch {
    /* the socket may have failed before it opened */
  }
}

export async function checkPort(host: string, port: number): Promise<Record<string, unknown>> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ApiError('invalid_port', 'The port must be between 1 and 65535.');
  }

  const resolved = await resolvePublicHost(host, port);
  const errors: string[] = [];

  for (const address of resolved.addresses) {
    const started = Date.now();
    let socket: Socket | null = null;
    try {
      socket = connect({ hostname: address, port }, { secureTransport: 'off' });
      await withTimeout(socket.opened, PORT_TIMEOUT_MS, 'Connection timed out.');
      const latency = Date.now() - started;
      return {
        ok: true,
        host,
        port,
        address,
        open: true,
        latency_ms: latency,
      };
    } catch (error) {
      errors.push(connectionError(error));
    } finally {
      await closeSocket(socket);
    }
  }

  return {
    ok: true,
    host,
    port,
    address: resolved.addresses[0] ?? '',
    open: false,
    error: errors.length > 0 ? errors[errors.length - 1] : 'No address could be reached.',
  };
}
