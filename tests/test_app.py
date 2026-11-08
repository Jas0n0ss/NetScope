"""Tests for the NetScope API and its network safety guards."""

from __future__ import annotations

import pytest

from pyapp import app as app_module


# --------------------------------------------------------------------------- #
# Fixtures                                                                    #
# --------------------------------------------------------------------------- #


@pytest.fixture()
def static_root(tmp_path):
    (tmp_path / "index.html").write_text("<!doctype html><title>NetScope test</title>", encoding="utf-8")
    assets = tmp_path / "assets"
    assets.mkdir()
    (assets / "favicon.svg").write_text("<svg xmlns='http://www.w3.org/2000/svg'></svg>", encoding="utf-8")
    (tmp_path / "site.webmanifest").write_text("{}", encoding="utf-8")
    (tmp_path / "robots.txt").write_text("User-agent: *\n", encoding="utf-8")
    return tmp_path


@pytest.fixture()
def client(static_root):
    app = app_module.create_app(static_root)
    app.config.update(TESTING=True)
    return app.test_client()


class FakeResponse:
    def __init__(self, body: bytes, headers: dict[str, str], status: int = 200, redirect: bool = False):
        self._body = body
        self.headers = headers
        self.status_code = status
        self.reason = "OK" if status == 200 else "Found"
        self.encoding = "utf-8"
        self.is_redirect = redirect

    def iter_content(self, chunk_size=16384):
        yield self._body

    def close(self):
        return None


# --------------------------------------------------------------------------- #
# Health, static delivery and headers                                         #
# --------------------------------------------------------------------------- #


def test_health(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["ok"] is True
    assert payload["service"] == "netscope"
    assert "inspect" in payload["features"]
    assert payload["version"] == app_module.APP_VERSION


def test_static_index_and_security_headers(client):
    response = client.get("/")
    assert response.status_code == 200
    assert b"NetScope test" in response.data
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert "frame-ancestors 'none'" in response.headers["Content-Security-Policy"]
    assert response.headers["X-Frame-Options"] == "DENY"


def test_static_allowlist_blocks_source(client):
    assert client.get("/pyapp/app.py").status_code == 404
    assert client.get("/.git/config").status_code == 404
    assert client.get("/README.md").status_code == 404
    assert client.get("/assets/favicon.svg").status_code == 200


def test_api_cors_headers(client):
    response = client.get("/api/health", headers={"Origin": "https://example.com"})
    assert response.headers["Access-Control-Allow-Origin"] == "*"
    assert response.headers["Cache-Control"] == "no-store"


def test_api_unknown_endpoint_is_json(client):
    response = client.get("/api/nope")
    assert response.status_code == 404
    assert response.is_json
    assert response.get_json()["error"]["code"] == "not_found"


# --------------------------------------------------------------------------- #
# Client IP                                                                   #
# --------------------------------------------------------------------------- #


def test_api_ip_uses_forwarded_header(client, monkeypatch):
    monkeypatch.setenv("TRUST_PROXY", "1")
    response = client.get("/api/ip", headers={"X-Forwarded-For": "8.8.8.8, 10.0.0.1"})
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["ip"] == "8.8.8.8"
    assert payload["family"] == "IPv4"
    assert payload["source"] == "client"


def test_plain_ip_endpoint(client, monkeypatch):
    monkeypatch.setenv("TRUST_PROXY", "1")
    response = client.get("/ip", headers={"X-Forwarded-For": "2606:4700:4700::1111"})
    assert response.status_code == 200
    assert response.data.decode().strip() == "2606:4700:4700::1111"
    assert response.mimetype == "text/plain"


# --------------------------------------------------------------------------- #
# SSRF guards                                                                 #
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/",
        "http://localhost:8080/",
        "http://10.1.2.3/admin",
        "http://192.168.1.1/",
        "http://169.254.169.254/latest/meta-data/",
        "http://[::1]/",
        "http://metadata.google.internal/",
        "ftp://example.com/file",
        "file:///etc/passwd",
        "https://user:pass@example.com/",
    ],
)
def test_validate_public_url_rejects(url):
    with pytest.raises(app_module.ApiError):
        app_module.validate_public_url(url)


def test_validate_public_url_allows_public():
    assert app_module.validate_public_url("https://example.com/a?b=1#frag") == "https://example.com/a?b=1"


def test_inspect_rejects_localhost(client):
    response = client.get("/api/inspect", query_string={"url": "http://127.0.0.1:8000/"})
    assert response.status_code == 403
    assert response.get_json()["error"]["code"] == "blocked_host"


def test_port_rejects_localhost(client):
    response = client.get("/api/port", query_string={"host": "localhost", "port": 80})
    assert response.status_code == 403


def test_port_validates_range(client):
    response = client.get("/api/port", query_string={"host": "example.com", "port": 70000})
    assert response.status_code == 400


def test_inspect_requires_url(client):
    response = client.get("/api/inspect")
    assert response.status_code == 400
    assert response.get_json()["error"]["code"] == "missing_url"


# --------------------------------------------------------------------------- #
# DNS validation                                                              #
# --------------------------------------------------------------------------- #


def test_dns_rejects_unknown_type(client):
    response = client.get("/api/dns", query_string={"name": "example.com", "type": "BOGUS"})
    assert response.status_code == 400
    assert response.get_json()["error"]["code"] == "invalid_type"


def test_dns_rejects_injection_name(client):
    response = client.get("/api/dns", query_string={"name": "example.com; rm -rf /", "type": "A"})
    assert response.status_code == 400
    assert response.get_json()["error"]["code"] == "invalid_name"


def test_clean_dns_name_allows_srv_underscores():
    assert app_module._clean_dns_name("_sip._tcp.example.com") == "_sip._tcp.example.com"


# --------------------------------------------------------------------------- #
# Inspection pipeline (network mocked)                                        #
# --------------------------------------------------------------------------- #


def test_inspect_parses_html_and_redacts_cookies(monkeypatch):
    html = b"""<!doctype html><html lang="en"><head>
      <title>  Example   Domain </title>
      <meta name="description" content="A test page">
      <meta property="og:title" content="OG Example">
      <link rel="canonical" href="/canonical">
      <link rel="icon" href="/icon.png">
    </head><body>ok</body></html>"""

    fake = FakeResponse(
        html,
        {
            "Content-Type": "text/html; charset=utf-8",
            "Server": "nginx",
            "Set-Cookie": "session=supersecret",
        },
    )

    monkeypatch.setattr(app_module, "resolve_public_host", lambda host, port=None: ["93.184.216.34"])
    monkeypatch.setattr(app_module, "tls_info", lambda host, port=443: {"subject": "example.com"})
    monkeypatch.setattr(app_module.requests.Session, "get", lambda self, *a, **k: fake)

    report = app_module.inspect_url("https://example.com/")

    assert report["status"] == 200
    assert report["meta"]["title"] == "Example Domain"
    assert report["meta"]["description"] == "A test page"
    assert report["meta"]["canonical"] == "https://example.com/canonical"
    assert report["meta"]["favicon"] == "https://example.com/icon.png"
    assert report["headers"]["Set-Cookie"] == "[redacted]"
    assert report["tls"]["subject"] == "example.com"
    assert report["ip"] == "93.184.216.34"
    assert report["body_bytes"] == len(html)


def test_metadata_parser_handles_missing_values():
    meta = app_module.extract_metadata("", "https://example.com")
    assert meta["title"] == ""
    assert meta["favicon"] == "https://example.com/favicon.ico"


# --------------------------------------------------------------------------- #
# Rate limiter                                                                #
# --------------------------------------------------------------------------- #


def test_rate_limiter_sliding_window():
    limiter = app_module.RateLimiter(limit=2, window=60)
    assert limiter.allow("a") is True
    assert limiter.allow("a") is True
    assert limiter.allow("a") is False
    assert limiter.allow("b") is True


def test_tls_info_rejects_invalid_expectation(monkeypatch):
    monkeypatch.setattr(app_module.socket, "create_connection", lambda *a, **k: (_ for _ in ()).throw(OSError("boom")))
    result = app_module.tls_info("example.com")
    assert "error" in result


# --------------------------------------------------------------------------- #
# SMTP diagnostics                                                            #
# --------------------------------------------------------------------------- #


def test_smtp_capability_parser():
    caps = app_module._smtp_capabilities([
        "250-smtp.example.com at your service",
        "250-SIZE 35882577",
        "250-STARTTLS",
        "250-AUTH LOGIN PLAIN XOAUTH2",
        "250-PIPELINING",
        "250-8BITMIME",
        "250 SMTPUTF8",
    ])
    assert caps["starttls"] is True
    assert caps["size"] == "35882577"
    assert caps["pipelining"] is True
    assert caps["8bitmime"] is True
    assert caps["smtputf8"] is True
    assert caps["auth"] == ["LOGIN", "PLAIN", "XOAUTH2"]


def test_smtp_rejects_localhost(client):
    response = client.get("/api/smtp", query_string={"host": "127.0.0.1", "port": 25})
    assert response.status_code == 403
    assert response.get_json()["error"]["code"] == "blocked_host"


def test_smtp_rejects_bad_mode(client):
    response = client.get("/api/smtp", query_string={"host": "example.com", "port": 587, "mode": "tls9000"})
    assert response.status_code == 400
    assert response.get_json()["error"]["code"] == "invalid_mode"


def test_smtp_unreachable_is_a_diagnostic(monkeypatch):
    monkeypatch.setattr(app_module, "resolve_public_host", lambda host, port=None: ["93.184.216.34"])
    monkeypatch.setattr(
        app_module.socket,
        "create_connection",
        lambda *args, **kwargs: (_ for _ in ()).throw(ConnectionRefusedError()),
    )
    result = app_module.smtp_lookup("smtp.example.com", 587)
    assert result["ok"] is True
    assert result["reachable"] is False
    assert "refused" in result["error"].lower()


def test_smtp_endpoint_returns_payload(client, monkeypatch):
    monkeypatch.setattr(
        app_module,
        "smtp_lookup",
        lambda host, port, mode: {
            "ok": True,
            "reachable": True,
            "host": host,
            "port": port,
            "mode": mode,
            "banner": ["220 test"],
            "capabilities": {"auth": [], "extensions": []},
        },
    )
    response = client.get("/api/smtp", query_string={"host": "smtp.example.com", "port": 587, "mode": "starttls"})
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["reachable"] is True
    assert payload["mode"] == "starttls"
