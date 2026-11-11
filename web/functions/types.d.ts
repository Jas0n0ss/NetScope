/**
 * Minimal ambient declarations for Cloudflare Pages Functions and the
 * `cloudflare:sockets` module.
 *
 * The project intentionally has no npm dependencies for the Functions layer,
 * so this file stands in for `@cloudflare/workers-types`.
 */

interface Env {
  /** Comma separated list of allowed CORS origins, or `*` (default). */
  CORS_ORIGINS?: string;
  RATE_LIMIT_GENERAL?: string;
  RATE_LIMIT_INSPECT?: string;
  RATE_LIMIT_PORT?: string;
  RATE_LIMIT_SMTP?: string;
}

interface EventContext<EnvType = Env, Params extends string = string, Data = Record<string, unknown>> {
  request: Request;
  env: EnvType;
  params: Record<Params, string | string[]>;
  data: Data;
  next(input?: Request | string, init?: RequestInit): Promise<Response>;
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

type PagesFunction<EnvType = Env, Params extends string = string, Data = Record<string, unknown>> = (
  context: EventContext<EnvType, Params, Data>,
) => Response | Promise<Response>;

declare module 'cloudflare:sockets' {
  interface SocketInfo {
    localAddress: string;
    localPort: number;
    remoteAddress: string;
    remotePort: number;
  }

  interface SocketOptions {
    secureTransport?: 'off' | 'on' | 'starttls';
    allowHalfOpen?: boolean;
  }

  interface SocketAddress {
    hostname: string;
    port: number;
  }

  interface Socket {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
    opened: Promise<SocketInfo>;
    closed: Promise<void>;
    startTls(): Socket;
    close(): Promise<void>;
  }

  export function connect(address: SocketAddress | string, options?: SocketOptions): Socket;
}
