/**
 * Read-only SMTP diagnostics: banner, EHLO capabilities and optional STARTTLS.
 *
 * Mirrors `smtp_lookup` / `_smtp_capabilities` in pyapp/app.py so the Email view
 * gets the same capability chips and warning strings. Workers cannot read the
 * peer certificate from `startTls()`, so the TLS block is filled from
 * Certificate Transparency (best effort, `null` when a lookup fails).
 */

import { connect, type Socket } from 'cloudflare:sockets';
import { ApiError } from './errors';
import { resolvePublicHost } from './target';
import { tlsInfo, isTlsError, type TlsResult } from './tls';
import { errorMessage, isTimeoutError, withTimeout } from './util';
import { closeSocket } from './port';

const SMTP_TIMEOUT_MS = 10000;
const SMTP_MAX_RESPONSE = 64 * 1024;
const SMTP_MAX_LINES = 100;
const SMTP_HELO_NAME = 'netscope.local';
const encoder = new TextEncoder();

export interface SmtpCapabilities {
  starttls: boolean;
  size: string;
  pipelining: boolean;
  '8bitmime': boolean;
  smtputf8: boolean;
  dsn: boolean;
  chunking: boolean;
  enhancedstatuscodes: boolean;
  auth: string[];
  extensions: string[];
}

function emptyCapabilities(): SmtpCapabilities {
  return {
    starttls: false,
    size: '',
    pipelining: false,
    '8bitmime': false,
    smtputf8: false,
    dsn: false,
    chunking: false,
    enhancedstatuscodes: false,
    auth: [],
    extensions: [],
  };
}

/** Port of `_smtp_capabilities`; keep the parsing rules in sync with Flask. */
export function smtpCapabilities(lines: string[]): SmtpCapabilities {
  const auth: string[] = [];
  const extensions: string[] = [];
  const caps = emptyCapabilities();

  for (const line of lines) {
    const text = line.length > 4 && (line[3] === '-' || line[3] === ' ') ? line.slice(4).trim() : line.trim();
    if (!text) continue;
    const upper = text.toUpperCase();

    if (upper.startsWith('AUTH ')) {
      for (const mechanism of upper.slice(5).replace(/=/g, ' ').split(/\s+/)) {
        if (mechanism && !auth.includes(mechanism)) auth.push(mechanism);
      }
      if (!extensions.includes('AUTH')) extensions.push('AUTH');
    } else if (upper.startsWith('SIZE')) {
      const parts = text.split(/\s+/);
      caps.size = parts.length > 1 ? parts[1] : '';
      extensions.push('SIZE');
    } else if (upper.startsWith('STARTTLS')) {
      caps.starttls = true;
      extensions.push('STARTTLS');
    } else if (upper.startsWith('PIPELINING')) {
      caps.pipelining = true;
      extensions.push('PIPELINING');
    } else if (upper.startsWith('8BITMIME')) {
      caps['8bitmime'] = true;
      extensions.push('8BITMIME');
    } else if (upper.startsWith('SMTPUTF8')) {
      caps.smtputf8 = true;
      extensions.push('SMTPUTF8');
    } else if (upper.startsWith('DSN')) {
      caps.dsn = true;
      extensions.push('DSN');
    } else if (upper.startsWith('CHUNKING')) {
      caps.chunking = true;
      extensions.push('CHUNKING');
    } else if (upper.startsWith('ENHANCEDSTATUSCODES')) {
      caps.enhancedstatuscodes = true;
      extensions.push('ENHANCEDSTATUSCODES');
    } else if (extensions.length < 20 && !upper.startsWith('SMTP')) {
      // Keep human-readable extensions (e.g. the greeting line) out of the chips.
      extensions.push(text.slice(0, 120));
    }
  }

  caps.auth = auth;
  caps.extensions = extensions.slice(0, 20);
  return caps;
}

class SmtpSession {
  private socket: Socket;
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private buffer = new Uint8Array(0);
  private total = 0;
  private deadline: number;
  private decoder = new TextDecoder();

  constructor(socket: Socket, deadline: number) {
    this.socket = socket;
    this.reader = socket.readable.getReader();
    this.writer = socket.writable.getWriter();
    this.deadline = deadline;
  }

  private remaining(): number {
    const left = this.deadline - Date.now();
    if (left <= 0) throw new Error('The SMTP server took too long to respond.');
    return left;
  }

  async write(command: string): Promise<void> {
    const data = encoder.encode(`${command}\r\n`);
    await withTimeout(this.writer.write(data), this.remaining(), 'The SMTP server did not accept a command.');
  }

  private async fill(): Promise<void> {
    const result = await withTimeout(this.reader.read(), this.remaining(), 'The SMTP server took too long to respond.');
    if (result.done) throw new Error('The SMTP server closed the connection.');
    const chunk = result.value;
    if (!chunk || chunk.byteLength === 0) return;
    this.total += chunk.byteLength;
    if (this.total > SMTP_MAX_RESPONSE) {
      throw new ApiError('smtp_response_too_large', 'The SMTP response exceeded the 64 KB limit.', 502);
    }
    const merged = new Uint8Array(this.buffer.byteLength + chunk.byteLength);
    merged.set(this.buffer);
    merged.set(chunk, this.buffer.byteLength);
    this.buffer = merged;
  }

  private async readLine(): Promise<string> {
    let index = this.buffer.indexOf(0x0a);
    while (index === -1) {
      await this.fill();
      index = this.buffer.indexOf(0x0a);
    }
    const bytes = this.buffer.subarray(0, index);
    this.buffer = this.buffer.subarray(index + 1);
    return this.decoder.decode(bytes).replace(/\r+$/, '');
  }

  async readResponse(): Promise<[number, string[]]> {
    const lines: string[] = [];
    for (;;) {
      const line = await this.readLine();
      lines.push(line.slice(0, 512));
      if (line.length >= 4 && /^\d{3}$/.test(line.slice(0, 3)) && line[3] === ' ') {
        return [Number.parseInt(line.slice(0, 3), 10), lines];
      }
      if (line.length === 3 && /^\d{3}$/.test(line)) {
        return [Number.parseInt(line, 10), lines];
      }
      if (lines.length > SMTP_MAX_LINES) {
        throw new ApiError('smtp_response_too_large', 'The SMTP response contained too many lines.', 502);
      }
    }
  }

  release(): void {
    try {
      this.reader.releaseLock();
    } catch {
      /* the reader may already be released */
    }
    try {
      this.writer.releaseLock();
    } catch {
      /* the writer may already be released */
    }
  }
}

function smtpError(error: unknown): string {
  if (isTimeoutError(error)) return 'Connection timed out.';
  const message = errorMessage(error).trim();
  if (/refused/i.test(message)) return 'Connection refused.';
  if (/proxy request failed|cannot connect to the specified address/i.test(message)) {
    return 'Cloudflare Workers cannot reach Cloudflare-owned IP ranges over TCP. Try a mail server that is not proxied by Cloudflare.';
  }
  if (/timed?\s?out|timeout/i.test(message)) return 'Connection timed out.';
  return message || 'Connection failed.';
}

function connectSocket(address: string, port: number, implicit: boolean): Socket {
  return connect({ hostname: address, port }, { secureTransport: implicit ? 'on' : 'starttls' });
}

export async function smtpLookup(host: string, port: number, mode: string): Promise<Record<string, unknown>> {
  if (mode !== 'auto' && mode !== 'starttls' && mode !== 'implicit') {
    throw new ApiError('invalid_mode', 'Mode must be auto, starttls or implicit.');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ApiError('invalid_port', 'The port must be between 1 and 65535.');
  }

  const resolved = await resolvePublicHost(host, port);
  const started = Date.now();
  let lastAddress = resolved.addresses[0] ?? '';
  let lastError = '';

  if (port === 25) {
    return {
      ok: true,
      reachable: false,
      host,
      port,
      mode,
      ip: lastAddress,
      error: 'Port 25 is blocked by Cloudflare Workers. Use 465, 587 or 2525.',
      elapsed_ms: Date.now() - started,
    };
  }

  // Workers cannot pin a resolved address while keeping the hostname for SNI:
  // `connect()` resolves the name itself, so TLS sees the real hostname. The
  // public-address pre-flight above still guards against SSRF.
  for (const address of resolved.addresses.slice(0, 1)) {
    lastAddress = address;
    const implicit = mode === 'implicit' || port === 465;
    let socket: Socket | null = null;
    let session: SmtpSession | null = null;

    try {
      socket = connectSocket(resolved.ascii, port, implicit);
      await withTimeout(socket.opened, SMTP_TIMEOUT_MS, 'Connection timed out.');
      session = new SmtpSession(socket, Date.now() + SMTP_TIMEOUT_MS);

      const warnings: string[] = [];
      let secure = implicit;
      let starttlsUsed = false;
      let starttlsAdvertised = false;
      let tlsPayload: TlsResult | null = null;

      const [bannerCode, banner] = await session.readResponse();
      let caps = emptyCapabilities();
      let ehloLines: string[] = [];

      if (bannerCode >= 200 && bannerCode < 400) {
        await session.write(`EHLO ${SMTP_HELO_NAME}`);
        const [, lines] = await session.readResponse();
        ehloLines = lines;
        caps = smtpCapabilities(lines);
        starttlsAdvertised = caps.starttls;

        const wantsStarttls = (mode === 'auto' || mode === 'starttls') && !implicit;
        if (wantsStarttls && caps.starttls) {
          await session.write('STARTTLS');
          const [starttlsCode] = await session.readResponse();
          if (starttlsCode === 220) {
            try {
              session.release();
              socket = socket.startTls();
              session = new SmtpSession(socket, Date.now() + SMTP_TIMEOUT_MS);
              secure = true;
              starttlsUsed = true;

              await session.write(`EHLO ${SMTP_HELO_NAME}`);
              const [, upgradedLines] = await session.readResponse();
              ehloLines = upgradedLines;
              caps = smtpCapabilities(upgradedLines);

              // Workers cannot read a peer certificate; CT is the only source.
              tlsPayload = await tlsInfo(resolved.ascii, port, { timeoutMs: 5000, fingerprint: false });
              if (isTlsError(tlsPayload)) tlsPayload = null;
            } catch (error) {
              if (error instanceof ApiError) throw error;
              warnings.push(`STARTTLS handshake failed: ${errorMessage(error)}`);
            }
          } else {
            warnings.push(`STARTTLS was refused with code ${starttlsCode}.`);
          }
        } else if (wantsStarttls && !caps.starttls) {
          warnings.push('The server did not advertise STARTTLS.');
        }
      } else {
        warnings.push(`The server did not return a valid banner (code ${bannerCode}).`);
      }

      // An implicit-TLS session has no negotiation step, so look the
      // certificate up once the banner proves the TLS handshake succeeded.
      if (implicit && secure && tlsPayload === null) {
        const details = await tlsInfo(resolved.ascii, port, { timeoutMs: 5000, fingerprint: false });
        tlsPayload = isTlsError(details) ? null : details;
      }

      if (!secure) warnings.push('This SMTP session is not encrypted.');
      if ([465, 587, 2525].includes(port) && caps.auth.length === 0) {
        warnings.push('No AUTH mechanism was advertised for this submission port.');
      }

      try {
        await session.write('QUIT');
        await session.readResponse();
      } catch {
        /* the server may close before acknowledging QUIT */
      }

      return {
        ok: true,
        reachable: true,
        host,
        port,
        mode,
        ip: address,
        banner,
        banner_code: bannerCode,
        ehlo: ehloLines,
        capabilities: caps,
        tls: tlsPayload,
        secure,
        implicit_tls: implicit,
        starttls_used: starttlsUsed,
        starttls_advertised: starttlsAdvertised,
        warnings,
        elapsed_ms: Date.now() - started,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      lastError = smtpError(error);
    } finally {
      session?.release();
      await closeSocket(socket);
    }
  }

  return {
    ok: true,
    reachable: false,
    host,
    port,
    mode,
    ip: lastAddress,
    error: lastError || 'No address could be reached.',
    elapsed_ms: Date.now() - started,
  };
}
