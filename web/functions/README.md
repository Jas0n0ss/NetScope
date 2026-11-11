# NetScope Pages Functions API

Same-origin port of the Flask inspector API (`pyapp/app.py`) to Cloudflare
Pages Functions. No npm dependencies: only `cloudflare:sockets` and Web APIs
(`fetch`, `crypto`, `AbortSignal`, `TextDecoder`/`TextEncoder`, streams).

```
web/functions/
├── types.d.ts              # minimal PagesFunction + cloudflare:sockets types
├── ip.ts                   # GET /ip (plain text)
├── api/[[path]].ts         # GET /api/* router
└── api/_lib/               # helpers (ignored by Pages routing, "_" prefix)
```

## Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/health` | `{ ok, service, version, features, runtime, time }` |
| GET | `/api/features` | `{ ok, version, features }` |
| GET | `/api/ip` | `cf-connecting-ip`, falls back to `api.ipify.org` |
| GET | `/ip` | plain text address + `\n` |
| GET | `/api/inspect?url=` | redirects, headers, TLS, metadata |
| GET | `/api/tls?host=&port=443` | certificate details from Certificate Transparency |
| GET | `/api/dns?name=&type=` | DoH JSON (Cloudflare, then Google) |
| GET | `/api/port?host=&port=` | single TCP connect via `cloudflare:sockets` |
| GET | `/api/smtp?host=&port=587&mode=auto` | banner, EHLO, STARTTLS |

`OPTIONS` is handled for every route. Everything else returns `405`.

Errors use the Flask envelope with an appropriate status:

```json
{ "ok": false, "error": { "code": "blocked_host", "message": "…", "hint": "…" } }
```

## Security

- **SSRF protection.** Before any outbound connection the hostname is resolved
  over DoH (A + AAAA). Loopback, private, link-local, CGNAT, ULA, multicast,
  documentation/reserved ranges, IPv4-mapped IPv6, NAT64 and 6to4 are rejected.
  Hostnames are rejected for `localhost`, `*.local`, `*.internal`,
  `*.localhost`, `*.home.arpa`, `*.localdomain`, bare single-label names and URL
  credentials. Every redirect hop is re-validated.
- **Rate limiting.** Per-isolate in-memory sliding windows, keyed by client IP +
  bucket: general 120/min, inspect 12/min, port 12/min, SMTP 15/min. Override
  with `RATE_LIMIT_GENERAL`, `RATE_LIMIT_INSPECT`, `RATE_LIMIT_PORT`,
  `RATE_LIMIT_SMTP`. **Caveat:** state is module scope, so each isolate has its
  own counters — this is best effort, not a global quota.
- **CORS.** `Access-Control-Allow-Origin` comes from `env.CORS_ORIGINS`
  (comma-separated list or `*`, the default). API responses are `no-store` and
  carry `X-Content-Type-Options: nosniff` and
  `Referrer-Policy: strict-origin-when-cross-origin`.
- The inspect body is capped at **512 KB** (Flask uses 2 MB) and the whole
  inspect request has a wall-clock budget so it finishes under 30 s. Each hop
  uses a 12 s timeout, with an 18 s budget for the HTTP phase.

## Limitations

- **TLS is reconstructed from Certificate Transparency**, not from the live
  handshake: Workers cannot read a peer certificate from `fetch()` or
  `connect()`. `/api/tls` queries `https://crt.sh/?q=<host>&output=json`, picks
  the newest still-valid certificate covering the host, and fetches
  `https://crt.sh/?d=<id>` for the SHA-256 fingerprint. Consequences:
  - `version` and `cipher` are always `""`, and `source` is
    `"certificate-transparency"`.
  - `serial` is crt.sh's `serial_number` (hex without separators; Flask returns
    the colon-separated DER serial).
  - Hosts without public CT entries (private CAs, many bare IPs) report
    `{ "error": "Certificate details are unavailable: …" }`; this endpoint
    never throws.
  - crt.sh is a third party and can be slow or unavailable. `/api/tls` uses a
    6 s timeout (the SMTP certificate lookup uses 5 s); failures are retried
    once unless the failure was a timeout. Fingerprints require a second
    request and are `""` when it fails.
  - `startTls()` exposes no certificate either, so the SMTP `tls` block is
    `null` (or CT data when the session is encrypted).
- **Port 25 is blocked by Cloudflare** for outbound TCP. `/api/smtp` with
  `port=25` returns `reachable: false` with
  `"Port 25 is blocked by Cloudflare Workers. Use 465, 587 or 2525."` without
  attempting a connection.
- SMTP connects to the **hostname**, not the pre-resolved IP, because Workers
  cannot set SNI separately from the connect target (`startTls()` rejects a
  certificate that is not valid for the address it dialled). SSRF is still
  rejected by the DoH pre-flight, but only the first resolved address is
  reported as `ip` and the server's own resolution wins. `/api/port` dials the
  resolved IP directly.
- Response header names from `fetch()` are lower-cased by the runtime; the
  original casing Flask preserved is not recoverable. `set-cookie` values are
  replaced with `"[redacted]"`.
- `resp.statusText` is often empty over HTTP/2, so a standard reason phrase is
  substituted when missing.
- SMTP capability parsing, warning strings, DNS status text and error codes are
  copied from `pyapp/app.py`. `capabilities` is the Flask object (not an array);
  `Email.tsx` currently checks `Array.isArray(smtp.capabilities)` before
  rendering chips, so the UI will not show them without a frontend tweak.
- The per-isolate limiter is not shared between `/api/*` and `/ip` modules.

## Running locally

```bash
cd web
npm run build
npx wrangler pages dev dist --port 8788 --ip 127.0.0.1
```

Then:

```bash
curl -s http://127.0.0.1:8788/api/health
curl -s 'http://127.0.0.1:8788/api/inspect?url=https://example.com'
curl -s 'http://127.0.0.1:8788/api/tls?host=example.com'
curl -s 'http://127.0.0.1:8788/api/dns?name=example.com&type=A'
curl -s 'http://127.0.0.1:8788/api/port?host=1.1.1.1&port=443'
curl -s 'http://127.0.0.1:8788/api/smtp?host=smtp.gmail.com&port=587'
```

`wrangler pages dev` serves the built `dist/` plus the Functions in
`web/functions/` at the same origin. The API is only reachable through the
Pages Functions runtime (`workerd`); plain `vite dev` does not run it.
