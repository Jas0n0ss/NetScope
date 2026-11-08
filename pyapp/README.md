# NetScope API

Flask backend for [NetScope](../README.md). It serves the static frontend and a
small, hardened API for website inspection, TLS certificates, DNS and TCP port
reachability.

## Run locally

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
# http://localhost:8080
```

`STATIC_DIR` defaults to the repository root, which already contains the
frontend. In the container image the same directory is `/app`.

## Endpoints

```text
GET /api/health
GET /api/ip
GET /ip
GET /api/inspect?url=https://example.com
GET /api/tls?host=example.com&port=443
GET /api/dns?name=example.com&type=A
GET /api/smtp?host=smtp.gmail.com&port=587&mode=auto
GET /api/port?host=example.com&port=443
GET /api/features
```

```bash
curl localhost:8080/ip
curl "localhost:8080/api/dns?name=example.com&type=MX"
curl "localhost:8080/api/inspect?url=https://example.com" | jq '.status, .meta.title'
curl "localhost:8080/api/smtp?host=smtp.gmail.com&port=587" | jq '.reachable, .capabilities.auth'
```

## Container

Build from the repository root:

```bash
docker build -f pyapp/Dockerfile -t netscope .
docker run --rm -p 8080:8080 netscope
```

Or use the root `Dockerfile` / `docker-compose.yml`, which build the same
full-stack image.

## Safety

- Public HTTP(S) only; private/loopback/link-local/reserved addresses are blocked.
- Every redirect is re-validated; credentials in URLs are rejected.
- 5 redirects, 2 MB body cap, 5s/12s timeouts, 4 KB header cap.
- `Set-Cookie` values are redacted.
- Rate limiting per client IP; set `TRUST_PROXY=1` behind a trusted proxy. SMTP checks are limited by `RATE_LIMIT_SMTP` (default 15/min).
- SMTP probing is read-only: banner, `EHLO`, optional `STARTTLS`, `QUIT`. No `AUTH`, `MAIL`, `RCPT` or message content is sent.
- TLS verification is enabled; CSP/COOP/nosniff headers are sent on static responses.

See the root README for the full security notes and configuration table.
