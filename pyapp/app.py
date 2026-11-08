"""NetScope API — website inspector, DNS, TLS and port reachability.

The public endpoints are read-only and only fetch public HTTP(S) resources.
Local, private, link-local and reserved addresses are blocked to prevent SSRF.
"""

from __future__ import annotations

import hashlib
import ipaddress
import math
import os
import re
import socket
import ssl
import threading
import time
from collections import deque
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import requests
from flask import Flask, Response, abort, jsonify, request, send_from_directory
from werkzeug.exceptions import HTTPException

try:  # optional at import time, required for /api/dns
    import dns.exception
    import dns.resolver

    HAVE_DNS = True
except Exception:  # pragma: no cover - exercised only when the dependency is absent
    dns = None
    HAVE_DNS = False

APP_VERSION = "2.0.0"
USER_AGENT = "NetScope/2.0 (+https://github.com/Jas0n0ss/lsp)"
MAX_REDIRECTS = 5
MAX_BODY_BYTES = 2 * 1024 * 1024
MAX_URL_LENGTH = 2048
REQUEST_TIMEOUT = (5, 12)
TLS_TIMEOUT = 8

DNS_TYPES = {"A", "AAAA", "CNAME", "MX", "TXT", "NS", "SOA", "CAA", "PTR", "SRV"}
DNS_STATUS = {0: "NOERROR", 1: "FORMERR", 2: "SERVFAIL", 3: "NXDOMAIN", 4: "NOTIMP", 5: "REFUSED"}

CSP = (
    "default-src 'self'; "
    "script-src 'self'; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: https:; "
    "font-src 'self'; "
    "connect-src 'self' https: http://localhost:* http://127.0.0.1:*; "
    "manifest-src 'self'; "
    "base-uri 'self'; "
    "form-action 'self'; "
    "frame-ancestors 'none'; "
    "object-src 'none'"
)

BLOCKED_HOSTNAMES = {
    "localhost",
    "localhost.localdomain",
    "metadata",
    "metadata.google.internal",
    "instance-data",
    "169.254.169.254",
}
BLOCKED_SUFFIXES = (".local", ".internal", ".localhost", ".home.arpa", ".localdomain")
ALLOWED_STATIC = {"index.html", "site.webmanifest", "robots.txt", "favicon.ico"}


# --------------------------------------------------------------------------- #
# Errors & rate limiting                                                      #
# --------------------------------------------------------------------------- #


class ApiError(Exception):
    def __init__(self, code: str, message: str, status: int = 400, hint: str = ""):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.hint = hint


class RateLimiter:
    """Small in-process sliding-window limiter (per worker)."""

    def __init__(self, limit: int, window: int = 60):
        self.limit = limit
        self.window = window
        self._hits: dict[str, deque] = {}
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            bucket = self._hits.setdefault(key, deque())
            while bucket and now - bucket[0] > self.window:
                bucket.popleft()
            if len(bucket) >= self.limit:
                return False
            bucket.append(now)
            # opportunistic cleanup of stale keys
            if len(self._hits) > 4096:
                for stale in [k for k, v in self._hits.items() if not v or now - v[-1] > self.window * 2]:
                    self._hits.pop(stale, None)
            return True


GENERAL_LIMITER = RateLimiter(int(os.environ.get("RATE_LIMIT_GENERAL", "120")))
INSPECT_LIMITER = RateLimiter(int(os.environ.get("RATE_LIMIT_INSPECT", "12")))
PORT_LIMITER = RateLimiter(int(os.environ.get("RATE_LIMIT_PORT", "12")))
SMTP_LIMITER = RateLimiter(int(os.environ.get("RATE_LIMIT_SMTP", "15")))


def client_ip() -> str:
    if os.environ.get("TRUST_PROXY") == "1":
        forwarded = request.headers.get("X-Forwarded-For", "")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return request.remote_addr or "unknown"


def enforce_rate(limiter: RateLimiter, bucket: str) -> None:
    if not limiter.allow(f"{bucket}:{client_ip()}"):
        raise ApiError(
            "rate_limited",
            "Too many requests. Please wait a minute and try again.",
            429,
            hint="Rate limits are per client IP and reset on a sliding window.",
        )


# --------------------------------------------------------------------------- #
# Network safety                                                              #
# --------------------------------------------------------------------------- #


def _normalize_ip(value: str) -> ipaddress._BaseAddress:
    return ipaddress.ip_address(value.split("%")[0])


def _require_public_ip(value: str) -> None:
    try:
        address = _normalize_ip(value)
    except ValueError as exc:
        raise ApiError("invalid_host", "The host did not resolve to a valid IP address.") from exc
    if not address.is_global or address.is_multicast:
        raise ApiError(
            "blocked_host",
            "Private, loopback, link-local and reserved addresses are not allowed.",
            403,
            hint="NetScope only inspects public internet resources.",
        )


def resolve_public_host(host: str, port: int | None = None) -> list[str]:
    clean = host.strip().strip("[]").rstrip(".").lower()
    if not clean:
        raise ApiError("invalid_host", "Enter a hostname or IP address.")
    if clean in BLOCKED_HOSTNAMES or any(clean.endswith(suffix) for suffix in BLOCKED_SUFFIXES):
        raise ApiError("blocked_host", "That hostname is not allowed.", 403)

    try:
        ipaddress.ip_address(clean)
        _require_public_ip(clean)
        return [clean]
    except ValueError:
        pass

    try:
        ascii_host = clean.encode("idna").decode("ascii")
    except UnicodeError as exc:
        raise ApiError("invalid_host", "The hostname could not be converted to ASCII.") from exc

    try:
        infos = socket.getaddrinfo(ascii_host, port or 443, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise ApiError("dns_error", f"Could not resolve {clean}.", 422) from exc

    addresses = []
    for info in infos:
        address = info[4][0]
        if address not in addresses:
            addresses.append(address)
    if not addresses:
        raise ApiError("dns_error", f"Could not resolve {clean}.", 422)
    for address in addresses:
        _require_public_ip(address)
    return addresses


def validate_public_url(raw: str) -> str:
    if not raw or len(raw) > MAX_URL_LENGTH:
        raise ApiError("invalid_url", "Enter a URL shorter than 2048 characters.")
    candidate = raw.strip()
    if not re.match(r"^[a-z][a-z0-9+.-]*://", candidate, re.IGNORECASE):
        candidate = f"https://{candidate}"
    parts = urlsplit(candidate)
    if parts.scheme not in {"http", "https"}:
        raise ApiError("invalid_scheme", "Only http:// and https:// URLs can be inspected.")
    if not parts.hostname:
        raise ApiError("invalid_url", "The URL is missing a hostname.")
    if parts.username or parts.password:
        raise ApiError("invalid_url", "URLs with embedded credentials are not allowed.")
    try:
        port = parts.port
    except ValueError as exc:
        raise ApiError("invalid_url", "The URL contains an invalid port.") from exc
    if port is not None and not 1 <= port <= 65535:
        raise ApiError("invalid_url", "The port must be between 1 and 65535.")
    resolve_public_host(parts.hostname, port)
    # Remove fragments: they are never sent to the server.
    return parts._replace(fragment="").geturl()


# --------------------------------------------------------------------------- #
# TLS                                                                         #
# --------------------------------------------------------------------------- #


def _cert_name(entries: tuple) -> str:
    data = {}
    for item in entries or ():
        for key, value in item:
            data.setdefault(key, value)
    return data.get("commonName") or data.get("organizationName") or ""


def _certificate_payload(tls_socket) -> dict:
    cert = tls_socket.getpeercert()
    der = tls_socket.getpeercert(binary_form=True)
    cipher = tls_socket.cipher()
    not_after = ssl.cert_time_to_seconds(cert["notAfter"])
    not_before = ssl.cert_time_to_seconds(cert["notBefore"])
    now = datetime.now(timezone.utc).timestamp()
    sans = [value for kind, value in cert.get("subjectAltName", ()) if kind in {"DNS", "IP Address"}]
    fingerprint = hashlib.sha256(der or b"").hexdigest().upper()
    return {
        "subject": _cert_name(cert.get("subject")),
        "issuer": _cert_name(cert.get("issuer")),
        "valid_from": datetime.fromtimestamp(not_before, tz=timezone.utc).isoformat(),
        "valid_to": datetime.fromtimestamp(not_after, tz=timezone.utc).isoformat(),
        "days_remaining": math.ceil((not_after - now) / 86400),
        "sans": sans,
        "serial": cert.get("serialNumber", ""),
        "fingerprint_sha256": ":".join(fingerprint[i:i + 2] for i in range(0, len(fingerprint), 2)),
        "version": tls_socket.version() or "",
        "cipher": cipher[0] if cipher else "",
    }


def tls_info(host: str, port: int = 443) -> dict:
    ascii_host = host
    try:
        ascii_host = host.encode("idna").decode("ascii")
    except UnicodeError:
        pass
    context = ssl.create_default_context()
    try:
        with socket.create_connection((ascii_host, port), timeout=TLS_TIMEOUT) as raw:
            with context.wrap_socket(raw, server_hostname=ascii_host) as tls:
                return _certificate_payload(tls)
    except ssl.SSLCertVerificationError as exc:
        return {"error": f"Certificate verification failed: {exc.verify_message or exc}"}
    except (ssl.SSLError, socket.timeout, OSError, ValueError) as exc:
        return {"error": f"TLS handshake failed: {exc}"}


# --------------------------------------------------------------------------- #
# SMTP diagnostics (read-only: banner, EHLO capabilities, optional STARTTLS)  #
# --------------------------------------------------------------------------- #

SMTP_TIMEOUT = 10
SMTP_MAX_RESPONSE = 64 * 1024
SMTP_HELO_NAME = "netscope.local"


class SmtpReader:
    """Line reader for an SMTP socket with a bounded total response size."""

    def __init__(self, sock, limit: int = SMTP_MAX_RESPONSE):
        self.sock = sock
        self.limit = limit
        self.buffer = b""
        self.total = 0

    def read_line(self) -> str:
        while b"\n" not in self.buffer:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise ConnectionError("The SMTP server closed the connection.")
            self.total += len(chunk)
            if self.total > self.limit:
                raise ApiError("smtp_response_too_large", "The SMTP response exceeded the 64 KB limit.", 502)
            self.buffer += chunk
        line, self.buffer = self.buffer.split(b"\n", 1)
        return line.rstrip(b"\r").decode("utf-8", "replace")

    def read_response(self) -> tuple[int, list[str]]:
        lines: list[str] = []
        while True:
            line = self.read_line()
            lines.append(line[:512])
            if len(line) >= 4 and line[:3].isdigit() and line[3] == " ":
                return int(line[:3]), lines
            if len(line) == 3 and line.isdigit():
                return int(line), lines
            if len(lines) > 100:
                raise ApiError("smtp_response_too_large", "The SMTP response contained too many lines.", 502)


def _smtp_send(sock, command: str) -> None:
    sock.sendall(command.encode("ascii", "replace") + b"\r\n")


def _smtp_capabilities(lines: list[str]) -> dict:
    auth: list[str] = []
    extensions: list[str] = []
    caps = {
        "starttls": False,
        "size": "",
        "pipelining": False,
        "8bitmime": False,
        "smtputf8": False,
        "dsn": False,
        "chunking": False,
        "enhancedstatuscodes": False,
        "auth": auth,
        "extensions": extensions,
    }
    for line in lines:
        text = line[4:].strip() if len(line) > 4 and line[3] in {"-", " "} else line.strip()
        if not text:
            continue
        upper = text.upper()
        if upper.startswith("AUTH "):
            for mechanism in upper[5:].replace("=", " ").split():
                if mechanism not in auth:
                    auth.append(mechanism)
            if "AUTH" not in extensions:
                extensions.append("AUTH")
        elif upper.startswith("SIZE"):
            parts = text.split()
            caps["size"] = parts[1] if len(parts) > 1 else ""
            extensions.append("SIZE")
        elif upper.startswith("STARTTLS"):
            caps["starttls"] = True
            extensions.append("STARTTLS")
        elif upper.startswith("PIPELINING"):
            caps["pipelining"] = True
            extensions.append("PIPELINING")
        elif upper.startswith("8BITMIME"):
            caps["8bitmime"] = True
            extensions.append("8BITMIME")
        elif upper.startswith("SMTPUTF8"):
            caps["smtputf8"] = True
            extensions.append("SMTPUTF8")
        elif upper.startswith("DSN"):
            caps["dsn"] = True
            extensions.append("DSN")
        elif upper.startswith("CHUNKING"):
            caps["chunking"] = True
            extensions.append("CHUNKING")
        elif upper.startswith("ENHANCEDSTATUSCODES"):
            caps["enhancedstatuscodes"] = True
            extensions.append("ENHANCEDSTATUSCODES")
        else:
            # Keep human-readable extensions (e.g. the greeting line) out of the chip list.
            if len(extensions) < 20 and not upper.startswith("SMTP"):
                extensions.append(text[:120])
    caps["auth"] = auth
    caps["extensions"] = extensions[:20]
    return caps


def smtp_lookup(host: str, port: int, mode: str = "auto") -> dict:
    if mode not in {"auto", "starttls", "implicit"}:
        raise ApiError("invalid_mode", "Mode must be auto, starttls or implicit.")
    if not 1 <= port <= 65535:
        raise ApiError("invalid_port", "The port must be between 1 and 65535.")

    addresses = resolve_public_host(host, port)
    sni_host = host
    try:
        sni_host = host.encode("idna").decode("ascii")
    except UnicodeError:
        pass
    context = ssl.create_default_context()
    started = time.perf_counter()
    last_error = ""
    last_address = addresses[0] if addresses else ""

    for address in addresses:
        last_address = address
        raw = None
        try:
            raw = socket.create_connection((address, port), timeout=SMTP_TIMEOUT)
            raw.settimeout(SMTP_TIMEOUT)
            implicit = mode == "implicit" or (mode == "auto" and port == 465)
            tls_payload = None
            warnings: list[str] = []
            secure = False
            starttls_used = False
            starttls_advertised = False

            if implicit:
                raw = context.wrap_socket(raw, server_hostname=sni_host)
                secure = True

            reader = SmtpReader(raw)
            banner_code, banner = reader.read_response()
            caps = {}
            ehlo_lines: list[str] = []

            if 200 <= banner_code < 400:
                _smtp_send(raw, f"EHLO {SMTP_HELO_NAME}")
                ehlo_code, ehlo_lines = reader.read_response()
                caps = _smtp_capabilities(ehlo_lines)
                starttls_advertised = bool(caps.get("starttls"))

                wants_starttls = mode in {"auto", "starttls"} and not implicit
                if wants_starttls and caps.get("starttls"):
                    _smtp_send(raw, "STARTTLS")
                    starttls_code, starttls_lines = reader.read_response()
                    if starttls_code == 220:
                        try:
                            raw = context.wrap_socket(raw, server_hostname=sni_host)
                            secure = True
                            starttls_used = True
                            tls_payload = _certificate_payload(raw)
                            reader = SmtpReader(raw)
                            _smtp_send(raw, f"EHLO {SMTP_HELO_NAME}")
                            _, ehlo_lines = reader.read_response()
                            caps = _smtp_capabilities(ehlo_lines)
                        except (ssl.SSLError, OSError, ValueError) as exc:
                            warnings.append(f"STARTTLS handshake failed: {exc}")
                    else:
                        warnings.append(f"STARTTLS was refused with code {starttls_code}.")
                elif wants_starttls and not caps.get("starttls"):
                    warnings.append("The server did not advertise STARTTLS.")
            else:
                warnings.append(f"The server did not return a valid banner (code {banner_code}).")

            if not secure:
                warnings.append("This SMTP session is not encrypted.")
            if port in {465, 587, 2525} and not caps.get("auth"):
                warnings.append("No AUTH mechanism was advertised for this submission port.")

            try:
                raw.settimeout(2)
                _smtp_send(raw, "QUIT")
                reader.read_response()
            except Exception:
                pass

            return {
                "ok": True,
                "reachable": True,
                "host": host,
                "port": port,
                "mode": mode,
                "ip": address,
                "banner": banner,
                "banner_code": banner_code,
                "ehlo": ehlo_lines,
                "capabilities": caps,
                "tls": tls_payload,
                "secure": secure,
                "implicit_tls": implicit,
                "starttls_used": starttls_used,
                "starttls_advertised": starttls_advertised,
                "warnings": warnings,
                "elapsed_ms": round((time.perf_counter() - started) * 1000),
            }
        except (socket.timeout, TimeoutError):
            last_error = "Connection timed out."
        except ConnectionRefusedError:
            last_error = "Connection refused."
        except ApiError:
            raise
        except (OSError, ssl.SSLError, ValueError) as exc:
            last_error = str(exc) or exc.__class__.__name__
        finally:
            if raw is not None:
                try:
                    raw.close()
                except OSError:
                    pass

    return {
        "ok": True,
        "reachable": False,
        "host": host,
        "port": port,
        "mode": mode,
        "ip": last_address,
        "error": last_error or "No address could be reached.",
        "elapsed_ms": round((time.perf_counter() - started) * 1000),
    }


# --------------------------------------------------------------------------- #
# HTML metadata                                                               #
# --------------------------------------------------------------------------- #


class MetadataParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title = ""
        self._in_title = False
        self.lang = ""
        self.meta: dict[str, str] = {}
        self.og: dict[str, str] = {}
        self.twitter: dict[str, str] = {}
        self.canonical = ""
        self.icons: list[str] = []

    def handle_starttag(self, tag, attrs):
        attributes = {key.lower(): (value or "") for key, value in attrs}
        if tag == "html":
            self.lang = attributes.get("lang", "").strip()
        elif tag == "title":
            self._in_title = True
        elif tag == "meta":
            name = attributes.get("name", "").strip().lower()
            prop = attributes.get("property", "").strip().lower()
            content = attributes.get("content", "").strip()
            if name:
                self.meta[name] = content
            if prop.startswith("og:"):
                self.og[prop[3:]] = content
            if name.startswith("twitter:"):
                self.twitter[name[8:]] = content
        elif tag == "link":
            rel = attributes.get("rel", "").lower()
            href = attributes.get("href", "").strip()
            if href and "canonical" in rel:
                self.canonical = href
            if href and "icon" in rel:
                self.icons.append(href)

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False

    def handle_data(self, data):
        if self._in_title and len(self.title) < 400:
            self.title += data


def extract_metadata(text: str, base_url: str) -> dict:
    parser = MetadataParser()
    try:
        parser.feed(text)
    except Exception:
        pass
    title = re.sub(r"\s+", " ", parser.title).strip()[:300]
    description = (parser.meta.get("description") or parser.og.get("description") or "").strip()[:1000]
    image = parser.og.get("image") or parser.meta.get("twitter:image") or ""
    favicon = parser.icons[0] if parser.icons else "/favicon.ico"
    return {
        "title": title,
        "description": description,
        "canonical": urljoin(base_url, parser.canonical) if parser.canonical else "",
        "robots": parser.meta.get("robots", ""),
        "viewport": parser.meta.get("viewport", ""),
        "generator": parser.meta.get("generator", ""),
        "lang": parser.lang,
        "favicon": urljoin(base_url, favicon),
        "og": {
            "title": parser.og.get("title", ""),
            "description": parser.og.get("description", ""),
            "image": urljoin(base_url, image) if image else "",
            "type": parser.og.get("type", ""),
            "site_name": parser.og.get("site_name", ""),
        },
        "twitter": {
            "card": parser.twitter.get("card", ""),
            "title": parser.twitter.get("title", ""),
            "description": parser.twitter.get("description", ""),
            "image": urljoin(base_url, parser.twitter.get("image", "")) if parser.twitter.get("image") else "",
        },
    }


# --------------------------------------------------------------------------- #
# Fetch / inspect                                                             #
# --------------------------------------------------------------------------- #


def _safe_headers(headers) -> dict[str, str]:
    output = {}
    for key, value in headers.items():
        if key.lower() == "set-cookie":
            output[key] = "[redacted]"
        else:
            output[key] = str(value)[:4096]
    return output


def inspect_url(raw_url: str) -> dict:
    requested = raw_url.strip()
    current = validate_public_url(requested)
    session = requests.Session()
    session.headers.update({
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    })
    redirects: list[dict] = []
    total_started = time.perf_counter()

    for attempt in range(MAX_REDIRECTS + 1):
        step_started = time.perf_counter()
        try:
            response = session.get(
                current,
                allow_redirects=False,
                stream=True,
                timeout=REQUEST_TIMEOUT,
            )
        except requests.Timeout as exc:
            raise ApiError("upstream_timeout", "The upstream server took too long to respond.", 504) from exc
        except requests.RequestException as exc:
            raise ApiError("upstream_error", f"The site could not be reached: {exc.__class__.__name__}.", 502) from exc

        step_elapsed = round((time.perf_counter() - step_started) * 1000)
        if response.is_redirect:
            location = response.headers.get("Location", "")
            response.close()
            if not location:
                break
            if attempt >= MAX_REDIRECTS:
                raise ApiError("too_many_redirects", f"More than {MAX_REDIRECTS} redirects were returned.", 422)
            next_url = validate_public_url(urljoin(current, location))
            redirects.append({
                "url": current,
                "status": response.status_code,
                "location": next_url,
                "elapsed_ms": step_elapsed,
            })
            current = next_url
            continue

        chunks = []
        size = 0
        truncated = False
        try:
            for chunk in response.iter_content(chunk_size=16384):
                if not chunk:
                    continue
                remaining = MAX_BODY_BYTES - size
                if remaining <= 0:
                    truncated = True
                    break
                chunks.append(chunk[:remaining])
                size += min(len(chunk), remaining)
                if size >= MAX_BODY_BYTES:
                    truncated = True
                    break
        except requests.RequestException:
            truncated = True
        finally:
            response.close()

        body = b"".join(chunks)
        content_type = response.headers.get("Content-Type", "")
        charset = response.encoding or "utf-8"
        text = ""
        if "html" in content_type.lower() or body.lstrip()[:1] == b"<":
            try:
                text = body.decode(charset, errors="replace")
            except LookupError:
                text = body.decode("utf-8", errors="replace")

        meta = extract_metadata(text, current) if text else extract_metadata("", current)
        hostname = urlsplit(current).hostname or ""
        try:
            addresses = resolve_public_host(hostname)
            ip = addresses[0] if addresses else ""
        except ApiError:
            ip = ""
        is_https = current.startswith("https://")
        tls = tls_info(hostname, urlsplit(current).port or 443) if is_https else None
        if is_https and tls is None:
            tls = {"error": "TLS information was not available."}

        return {
            "ok": True,
            "requested_url": requested,
            "final_url": current,
            "status": response.status_code,
            "reason": response.reason,
            "elapsed_ms": round((time.perf_counter() - total_started) * 1000),
            "redirects": redirects,
            "headers": _safe_headers(response.headers),
            "content_type": content_type,
            "body_bytes": size,
            "truncated": truncated,
            "https": is_https,
            "tls": tls,
            "meta": meta,
            "ip": ip,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }

    raise ApiError("too_many_redirects", "The redirect chain could not be completed.", 422)


# --------------------------------------------------------------------------- #
# DNS / port                                                                  #
# --------------------------------------------------------------------------- #


def _clean_dns_name(value: str) -> str:
    name = value.strip().rstrip(".")
    if not name or len(name) > 253:
        raise ApiError("invalid_name", "Enter a valid domain name.")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", name):
        raise ApiError("invalid_name", "The domain contains unsupported characters.")
    try:
        return name.encode("idna").decode("ascii")
    except UnicodeError as exc:
        if name.isascii():
            return name
        raise ApiError("invalid_name", "The domain could not be converted to ASCII.") from exc


def _dns_value(record, qtype: str) -> str:
    if qtype == "MX":
        return f"{record.preference} {record.exchange}"
    if qtype == "TXT":
        parts = getattr(record, "strings", ())
        return "".join(part.decode("utf-8", "replace") if isinstance(part, bytes) else str(part) for part in parts)
    if qtype == "SOA":
        return (
            f"{record.mname} {record.rname} {record.serial} "
            f"{record.refresh} {record.retry} {record.expire} {record.minimum}"
        )
    if qtype == "CAA":
        tag = record.tag.decode("utf-8", "replace") if isinstance(record.tag, bytes) else str(record.tag)
        value = record.value.decode("utf-8", "replace") if isinstance(record.value, bytes) else str(record.value)
        return f'{record.flags} {tag} "{value}"'
    if qtype == "SRV":
        return f"{record.priority} {record.weight} {record.port} {record.target}"
    return record.to_text()


def dns_lookup(raw_name: str, qtype: str) -> dict:
    qtype = qtype.upper()
    if qtype not in DNS_TYPES:
        raise ApiError("invalid_type", f"Unsupported record type. Use one of: {', '.join(sorted(DNS_TYPES))}.")

    name = raw_name.strip()
    if not name:
        raise ApiError("invalid_name", "Enter a domain name or IP address.")
    if qtype == "PTR":
        try:
            name = ipaddress.ip_address(name).reverse_pointer
        except ValueError:
            name = name.rstrip(".")
    name = _clean_dns_name(name)

    if not HAVE_DNS:
        raise ApiError("dns_unavailable", "Server-side DNS is unavailable; use the browser DoH resolver.", 503)

    started = time.perf_counter()
    status = 0
    answers = []
    authority = []
    try:
        resolver = dns.resolver.Resolver()
        resolver.lifetime = 6
        resolver.timeout = 4
        result = resolver.resolve(name, qtype, raise_on_no_answer=False)
        if result.rrset is not None:
            for record in result:
                answers.append({
                    "name": result.qname.to_text(),
                    "type": qtype,
                    "ttl": int(result.rrset.ttl),
                    "data": _dns_value(record, qtype),
                })
    except dns.resolver.NXDOMAIN:
        status = 3
    except dns.resolver.NoNameservers:
        status = 2
    except (dns.exception.Timeout, dns.resolver.LifetimeTimeout):
        raise ApiError("dns_timeout", "The DNS query timed out.", 504)
    except dns.exception.DNSException as exc:
        raise ApiError("dns_error", f"DNS lookup failed: {exc.__class__.__name__}.", 502) from exc

    return {
        "ok": True,
        "name": name,
        "type": qtype,
        "status": status,
        "status_text": DNS_STATUS.get(status, f"Status {status}"),
        "answers": answers,
        "authority": authority,
        "elapsed_ms": round((time.perf_counter() - started) * 1000),
    }


def check_port(host: str, port: int) -> dict:
    if not 1 <= port <= 65535:
        raise ApiError("invalid_port", "The port must be between 1 and 65535.")
    addresses = resolve_public_host(host, port)
    errors = []
    for address in addresses:
        started = time.perf_counter()
        try:
            with socket.create_connection((address, port), timeout=4):
                latency = round((time.perf_counter() - started) * 1000)
                return {
                    "ok": True,
                    "host": host,
                    "port": port,
                    "address": address,
                    "open": True,
                    "latency_ms": latency,
                }
        except (socket.timeout, TimeoutError):
            errors.append("Connection timed out.")
        except ConnectionRefusedError:
            errors.append("Connection refused.")
        except OSError as exc:
            errors.append(str(exc))
    return {
        "ok": True,
        "host": host,
        "port": port,
        "address": addresses[0] if addresses else "",
        "open": False,
        "error": errors[-1] if errors else "No address could be reached.",
    }


# --------------------------------------------------------------------------- #
# App factory                                                                 #
# --------------------------------------------------------------------------- #


def create_app(static_dir: str | os.PathLike | None = None) -> Flask:
    static_root = Path(
        static_dir
        or os.environ.get("STATIC_DIR")
        or Path(__file__).resolve().parent.parent
    ).resolve()

    app = Flask(__name__, static_folder=None)
    app.config.update(
        MAX_CONTENT_LENGTH=256 * 1024,
        STATIC_ROOT=str(static_root),
    )
    app.json.sort_keys = False

    @app.after_request
    def add_headers(response: Response) -> Response:
        if request.path.startswith("/api/"):
            allowed = os.environ.get("CORS_ORIGINS", "*").strip()
            origin = request.headers.get("Origin", "")
            if allowed == "*":
                response.headers["Access-Control-Allow-Origin"] = "*"
            elif origin and origin in {item.strip() for item in allowed.split(",") if item.strip()}:
                response.headers["Access-Control-Allow-Origin"] = origin
                response.headers["Vary"] = "Origin"
            response.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
            response.headers["Access-Control-Allow-Headers"] = "Accept, Content-Type"
            response.headers["Access-Control-Max-Age"] = "600"
            response.headers["Cache-Control"] = "no-store"
        else:
            response.headers.setdefault("Content-Security-Policy", CSP)
            response.headers.setdefault("Cache-Control", "no-cache")
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=()"
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        return response

    @app.errorhandler(ApiError)
    def handle_api_error(error: ApiError):
        response = jsonify({
            "ok": False,
            "error": {"code": error.code, "message": error.message, "hint": error.hint},
        })
        response.status_code = error.status
        if error.status == 429:
            response.headers["Retry-After"] = "60"
        return response

    @app.errorhandler(404)
    def handle_not_found(_error):
        if request.path.startswith("/api/"):
            return jsonify({"ok": False, "error": {"code": "not_found", "message": "Endpoint not found.", "hint": ""}}), 404
        return Response("Not found\n", status=404, mimetype="text/plain")

    @app.errorhandler(Exception)
    def handle_unexpected(error):
        if isinstance(error, ApiError):
            return handle_api_error(error)
        if isinstance(error, HTTPException):
            if request.path.startswith("/api/"):
                return jsonify({
                    "ok": False,
                    "error": {
                        "code": error.name.lower().replace(" ", "_"),
                        "message": error.description,
                        "hint": "",
                    },
                }), error.code
            return Response(error.description or error.name, status=error.code, mimetype="text/plain")
        app.logger.exception("Unhandled error: %s", error)
        if request.path.startswith("/api/"):
            return jsonify({
                "ok": False,
                "error": {"code": "internal_error", "message": "Unexpected server error.", "hint": ""},
            }), 500
        return Response("Internal server error\n", status=500, mimetype="text/plain")

    # ---------- static ----------
    @app.get("/")
    def index():
        return send_from_directory(static_root, "index.html", max_age=0)

    @app.get("/favicon.ico")
    def favicon():
        return send_from_directory(static_root, "assets/favicon.svg", max_age=86400, mimetype="image/svg+xml")

    @app.get("/<path:filename>")
    def static_file(filename: str):
        if filename.startswith("api/"):
            abort(404)
        allowed = filename in ALLOWED_STATIC or filename.startswith("assets/")
        if not allowed:
            abort(404)
        return send_from_directory(static_root, filename, max_age=3600)

    # ---------- IP ----------
    def public_ip_payload() -> dict:
        address = client_ip()
        source = "client"
        try:
            parsed = ipaddress.ip_address(address.split("%")[0])
            is_public = parsed.is_global
        except ValueError:
            is_public = False
        if not is_public:
            try:
                echoed = requests.get(
                    "https://api.ipify.org?format=json",
                    timeout=5,
                    headers={"User-Agent": USER_AGENT},
                )
                echoed.raise_for_status()
                address = echoed.json().get("ip", address)
                source = "server-egress"
            except Exception:
                source = "client-private"
        family = "IPv6" if ":" in address else "IPv4"
        return {"ok": True, "ip": address, "family": family, "source": source}

    @app.get("/api/ip")
    def api_ip():
        enforce_rate(GENERAL_LIMITER, "ip")
        return jsonify(public_ip_payload())

    @app.get("/ip")
    def plain_ip():
        enforce_rate(GENERAL_LIMITER, "ip")
        payload = public_ip_payload()
        return Response(payload["ip"] + "\n", mimetype="text/plain")

    # ---------- health ----------
    @app.get("/api/health")
    def health():
        return jsonify({
            "ok": True,
            "service": "netscope",
            "version": APP_VERSION,
            "features": ["inspect", "tls", "dns", "smtp", "port", "ip"],
            "time": datetime.now(timezone.utc).isoformat(),
        })

    # ---------- inspect ----------
    @app.get("/api/inspect")
    def api_inspect():
        enforce_rate(GENERAL_LIMITER, "inspect-general")
        enforce_rate(INSPECT_LIMITER, "inspect")
        url = request.args.get("url", "").strip()
        if not url:
            raise ApiError("missing_url", "Pass a url query parameter.")
        return jsonify(inspect_url(url))

    # ---------- tls ----------
    @app.get("/api/tls")
    def api_tls():
        enforce_rate(GENERAL_LIMITER, "tls")
        host = request.args.get("host", "").strip()
        if not host:
            raise ApiError("missing_host", "Pass a host query parameter.")
        try:
            port = int(request.args.get("port", "443"))
        except ValueError as exc:
            raise ApiError("invalid_port", "The port must be an integer.") from exc
        resolve_public_host(host, port)
        details = tls_info(host, port)
        return jsonify({"ok": True, "host": host, "port": port, "tls": details})

    # ---------- dns ----------
    @app.get("/api/dns")
    def api_dns():
        enforce_rate(GENERAL_LIMITER, "dns")
        name = request.args.get("name", "").strip()
        qtype = request.args.get("type", "A").strip().upper()
        if not name:
            raise ApiError("missing_name", "Pass a name query parameter.")
        return jsonify(dns_lookup(name, qtype))

    # ---------- port ----------
    @app.get("/api/port")
    def api_port():
        enforce_rate(GENERAL_LIMITER, "port-general")
        enforce_rate(PORT_LIMITER, "port")
        host = request.args.get("host", "").strip()
        if not host:
            raise ApiError("missing_host", "Pass a host query parameter.")
        try:
            port = int(request.args.get("port", "443"))
        except ValueError as exc:
            raise ApiError("invalid_port", "The port must be an integer.") from exc
        return jsonify(check_port(host, port))

    # ---------- smtp ----------
    @app.get("/api/smtp")
    def api_smtp():
        enforce_rate(GENERAL_LIMITER, "smtp-general")
        enforce_rate(SMTP_LIMITER, "smtp")
        host = request.args.get("host", "").strip()
        if not host:
            raise ApiError("missing_host", "Pass a host query parameter.")
        try:
            port = int(request.args.get("port", "587"))
        except ValueError as exc:
            raise ApiError("invalid_port", "The port must be an integer.") from exc
        mode = request.args.get("mode", "auto").strip().lower() or "auto"
        return jsonify(smtp_lookup(host, port, mode))

    # ---------- legacy convenience ----------
    @app.get("/api/features")
    def features():
        return jsonify({
            "ok": True,
            "version": APP_VERSION,
            "features": ["inspect", "tls", "dns", "smtp", "port", "ip"],
        })

    return app


app = create_app()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    debug = os.environ.get("FLASK_DEBUG") == "1"
    app.run(host="0.0.0.0", port=port, debug=debug)
