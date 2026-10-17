"""Shared test helpers: the import path, repo fixtures, a fake tracemark server and the ingest
schema rules from docs/ingest-protocol.md."""

from __future__ import annotations

import gzip
import json
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable, Dict, List, Tuple, Union

PACKAGE = Path(__file__).resolve().parent.parent
REPO = PACKAGE.parent.parent
sys.path.insert(0, str(PACKAGE / "src"))

VECTORS = REPO / "packages" / "flags" / "vectors.json"
FIXTURES = REPO / "packages" / "schema" / "fixtures"


class Recorded:
    def __init__(self, method: str, path: str, headers: Dict[str, str], raw: bytes) -> None:
        self.method = method
        self.path = path
        self.headers = headers
        self.raw = raw
        data = gzip.decompress(raw) if headers.get("content-encoding") == "gzip" else raw
        self.body: Any = json.loads(data) if data else None


Response = Tuple[int, Any]
Responder = Union[Response, Callable[["Recorded"], Response]]


class FakeServer:
    """A local tracemark: records every request and answers from per-path scripts.

    ``script(path, *responses)`` queues answers for a path; once used up, the default answers
    (``202`` for ``/e``, ``404`` otherwise) apply.
    """

    def __init__(self) -> None:
        self.requests: List[Recorded] = []
        self.lock = threading.Lock()
        self.scripts: Dict[str, List[Responder]] = {}
        self.defaults: Dict[str, Responder] = {"/e": lambda r: (202, {"accepted": len(r.body["batch"])})}
        server = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, format: str, *args: Any) -> None:
                pass

            def _handle(self) -> None:
                length = int(self.headers.get("content-length") or 0)
                raw = self.rfile.read(length) if length else b""
                path = self.path.split("?")[0]
                record = Recorded(self.command, path, {k.lower(): v for k, v in self.headers.items()}, raw)
                with server.lock:
                    server.requests.append(record)
                    queued = server.scripts.get(path)
                    responder = queued.pop(0) if queued else server.defaults.get(path, (404, {"error": "not_found"}))
                status, body = responder(record) if callable(responder) else responder
                data = json.dumps(body).encode()
                self.send_response(status)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            do_GET = _handle
            do_POST = _handle

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.httpd.daemon_threads = True
        self.url = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        self.thread = threading.Thread(target=self.httpd.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True)
        self.thread.start()

    def script(self, path: str, *responses: Responder) -> None:
        with self.lock:
            self.scripts.setdefault(path, []).extend(responses)

    def on(self, path: str, responder: Responder) -> None:
        with self.lock:
            self.defaults[path] = responder

    def to(self, path: str) -> List[Recorded]:
        with self.lock:
            return [r for r in self.requests if r.path == path]

    def events(self) -> List[Dict[str, Any]]:
        """Every event the server was sent and accepted (2xx), in order."""
        return [e for r in self.to("/e") for e in r.body["batch"]]

    def wait_for(self, predicate: Callable[[], bool], timeout: float = 5.0) -> bool:
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            if predicate():
                return True
            time.sleep(0.01)
        return predicate()

    def close(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()


def closed_port_url() -> str:
    """A local URL nothing listens on."""
    import socket

    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    return f"http://127.0.0.1:{port}"


# --- ingest schema rules (docs/ingest-protocol.md) -----------------------------------------------

_UUID = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
_RFC3339 = re.compile(
    r"(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(\.\d+)?([Zz]|[+-]\d{2}:\d{2})"
)


def _timestamp_ok(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    m = _RFC3339.fullmatch(value)
    if not m:
        return False
    year, month, day, hour, minute, second = (int(m.group(i)) for i in range(1, 7))
    return 1900 <= year <= 2299 and 1 <= month <= 12 and 1 <= day <= 31 and hour < 24 and minute < 60 and second < 61


def _short_string(value: Any, minimum: int = 0) -> bool:
    return isinstance(value, str) and minimum <= len(value) <= 200


def batch_errors(body: Any) -> List[str]:
    """Why ``POST /e`` would answer 400, or an empty list when it would accept the body."""
    errors: List[str] = []
    if not isinstance(body, dict) or not isinstance(body.get("batch"), list):
        return ["body must be an object with a batch array"]
    if not isinstance(body.get("api_key"), str) or not body["api_key"]:
        errors.append("api_key")
    if body.get("sent_at") is not None and not _timestamp_ok(body["sent_at"]):
        errors.append("sent_at")
    if len(body["batch"]) > 1000:
        errors.append("more than 1000 events")
    for i, event in enumerate(body["batch"]):
        if not isinstance(event, dict):
            errors.append(f"{i}: not an object")
            continue
        if not isinstance(event.get("uuid"), str) or not _UUID.fullmatch(event["uuid"]):
            errors.append(f"{i}.uuid")
        if not _short_string(event.get("event"), 1):
            errors.append(f"{i}.event")
        if not _short_string(event.get("distinct_id"), 1):
            errors.append(f"{i}.distinct_id")
        if not _timestamp_ok(event.get("timestamp")):
            errors.append(f"{i}.timestamp")
        if event.get("session_id") is not None and not _short_string(event["session_id"]):
            errors.append(f"{i}.session_id")
        if event.get("properties") is not None and not isinstance(event["properties"], dict):
            errors.append(f"{i}.properties")
        person = event.get("person")
        if person is not None:
            if not isinstance(person, dict):
                errors.append(f"{i}.person")
            else:
                for key in ("set", "set_once"):
                    if person.get(key) is not None and not isinstance(person[key], dict):
                        errors.append(f"{i}.person.{key}")
        groups = event.get("groups")
        if groups is not None:
            if not isinstance(groups, dict) or len(groups) > 5:
                errors.append(f"{i}.groups")
            else:
                for k, v in groups.items():
                    if not _short_string(k) or not _short_string(v):
                        errors.append(f"{i}.groups.{k}")
    return errors


def load_json(path: Path) -> Any:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def fixtures(kind: str) -> List[Tuple[str, Any]]:
    return [(p.name, load_json(p)) for p in sorted((FIXTURES / kind).glob("*.json"))]


def wait(seconds: float) -> None:
    time.sleep(seconds)


__all__ = [
    "FakeServer",
    "Recorded",
    "batch_errors",
    "closed_port_url",
    "fixtures",
    "load_json",
    "VECTORS",
    "FIXTURES",
    "REPO",
    "PACKAGE",
    "wait",
]
