"""Read-only by default; mutations require local-origin, session token & consent."""

from __future__ import annotations

from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import base64
import binascii
import json
from pathlib import Path
import secrets
from urllib.parse import parse_qs, urlsplit

from .vault import MemoryVault, VaultError


MAX_JSON_BYTES = 3 * 1024 * 1024
UI_ROOT = Path(__file__).resolve().parent / "ui"


def make_handler(vault: MemoryVault, token: str):

    class Handler(BaseHTTPRequestHandler):
        server_version = "NeuroMemoryCortex/0.4"

        def _headers(self, status=HTTPStatus.OK, mime="application/json; charset=utf-8", size=0):
            self.send_response(status)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(size))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", "default-src 'self'; "
                             "script-src 'self'; style-src 'self'; img-src 'self' data:; "
                             "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'")
            self.end_headers()

        def _send(self, status, data):
            body = json.dumps(data, ensure_ascii=False).encode("utf-8")
            self._headers(status, size=len(body))
            self.wfile.write(body)

        def _host_ok(self) -> bool:
            port = self.server.server_port
            allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
            return self.headers.get("Host", "") in allowed_hosts

        def _mutate_ok(self) -> bool:
            origin = self.headers.get("Origin")
            port = self.server.server_port
            allowed_origins = {f"http://127.0.0.1:{port}", f"http://localhost:{port}"}
            return (self.headers.get("X-NeuroMemory-Token") == token
                    and self.headers.get("Content-Type", "").split(";")[0].strip() == "application/json"
                    and (not origin or origin in allowed_origins))

        def _read_ok(self) -> bool:
            origin = self.headers.get("Origin")
            port = self.server.server_port
            allowed_origins = {f"http://127.0.0.1:{port}", f"http://localhost:{port}"}
            return self.headers.get("X-NeuroMemory-Token") == token and (
                not origin or origin in allowed_origins
            )

        def do_GET(self):
            if not self._host_ok():
                return self._send(HTTPStatus.FORBIDDEN, {"error": "Invalid local Host"})
            parsed = urlsplit(self.path)
            qs = parse_qs(parsed.query, keep_blank_values=True)
            try:
                if parsed.path == "/api/health":
                    return self._send(HTTPStatus.OK, {"status": "local_only", "schema": "phase1"})
                if parsed.path.startswith("/api/") and not self._read_ok():
                    return self._send(HTTPStatus.FORBIDDEN, {"error": "Local read authorization required"})
                if parsed.path == "/api/stats":
                    return self._send(HTTPStatus.OK, vault.stats())
                if parsed.path == "/api/neural-demo":
                    from .associative import synthetic_neural_demo
                    return self._send(HTTPStatus.OK, synthetic_neural_demo(include_trace=True))
                if parsed.path == "/api/sources":
                    return self._send(HTTPStatus.OK, {"items": vault.list_sources()})
                if parsed.path == "/api/claims":
                    return self._send(HTTPStatus.OK, {"items": vault.list_claims()})
                if parsed.path == "/api/passages":
                    return self._send(HTTPStatus.OK, {"items": vault.list_passages(qs.get("source_id", [""])[0])})
                if parsed.path == "/api/search":
                    return self._send(HTTPStatus.OK, {"items": vault.search(qs.get("q", [""])[0])})
                assets = {"/": ("index.html", "text/html; charset=utf-8"),
                          "/styles.css": ("styles.css", "text/css; charset=utf-8"),
                          "/morphology.js": ("morphology.js", "application/javascript; charset=utf-8"),
                          "/morphology3d.js": ("morphology3d.js", "application/javascript; charset=utf-8"),
                          "/app.js": ("app.js", "application/javascript; charset=utf-8")}
                if parsed.path not in assets:
                    return self._send(HTTPStatus.NOT_FOUND, {"error": "Not found"})
                filename, mime = assets[parsed.path]
                body = (UI_ROOT / filename).read_bytes()
                if filename == "index.html":
                    body = body.replace(b"__LOCAL_SESSION_TOKEN__", token.encode("ascii"))
                self._headers(HTTPStatus.OK, mime=mime, size=len(body))
                self.wfile.write(body)
            except VaultError as exc:
                self._send(HTTPStatus.BAD_REQUEST, {"error": str(exc)})

        def do_POST(self):
            if not self._host_ok() or not self._mutate_ok():
                return self._send(HTTPStatus.FORBIDDEN, {"error": "Local authorization required"})
            length_raw = self.headers.get("Content-Length", "")
            try:
                size = int(length_raw)
            except ValueError:
                return self._send(HTTPStatus.BAD_REQUEST, {"error": "Invalid request length"})
            if size < 1 or size > MAX_JSON_BYTES:
                return self._send(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "Request too large"})
            try:
                payload = json.loads(self.rfile.read(size).decode("utf-8"))
                if not isinstance(payload, dict):
                    raise VaultError("JSON 对象格式无效。")
                path = urlsplit(self.path).path
                if path == "/api/import":
                    if not isinstance(payload.get("content_base64"), str):
                        raise VaultError("必须发送原始文件字节的 Base64 表示。")
                    try:
                        raw_bytes = base64.b64decode(payload["content_base64"], validate=True)
                    except (ValueError, binascii.Error) as exc:
                        raise VaultError("上传文件 Base64 数据不合法。") from exc
                    result = vault.import_bytes(
                        str(payload.get("name", "")), raw_bytes,
                        consent=payload.get("consent") is True,
                        classification=payload.get("classification", "private")
                    )
                elif path == "/api/revoke":
                    result = vault.revoke_source(str(payload.get("source_id", "")),
                                                 consent=payload.get("consent") is True)
                elif path == "/api/propose":
                    result = vault.propose_claim(
                        source_id=str(payload.get("source_id", "")),
                        passage_id=str(payload.get("passage_id", "")),
                        statement=str(payload.get("statement", "")),
                        kind=str(payload.get("kind", "semantic")),
                        perspective="user_written"
                    )
                elif path == "/api/review":
                    result = vault.review_claim(
                        str(payload.get("claim_id", "")), str(payload.get("decision", "")),
                        consent=payload.get("consent") is True
                    )
                else:
                    return self._send(HTTPStatus.NOT_FOUND, {"error": "Not found"})
                return self._send(HTTPStatus.OK, result)
            except (UnicodeDecodeError, json.JSONDecodeError, VaultError) as exc:
                self._send(HTTPStatus.BAD_REQUEST, {"error": str(exc)})

        def log_message(self, fmt, *args):
            # Avoid logging full URLs: search query strings may contain private text.
            action = self.command
            print(f"[local HTTP] {action} status={args[1] if len(args) > 1 else '?'}")

    return Handler


def serve_local(vault: MemoryVault, *, port: int = 8765) -> None:
    if not 1024 <= port <= 65535:
        raise VaultError("服务端口必须在 1024–65535 之间。")
    token = secrets.token_hex(32)
    server = ThreadingHTTPServer(("127.0.0.1", port), make_handler(vault, token))
    print(f"NeuroMemory Cortex • http://127.0.0.1:{port}")
    print("Local-only. No model, cloud, network crawler or personal files are auto-connected.")
    try:
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
