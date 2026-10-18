"""The tracemark client for Python servers."""

from __future__ import annotations

import atexit
import gzip as _gzip
import json
import logging
import math
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import deque
from dataclasses import dataclass
from datetime import date, datetime, timezone
from types import TracebackType
from typing import Any, Callable, Deque, Dict, Iterable, List, Mapping, Optional, Set, Tuple, Type, cast

from ._exceptions import exception_list
from ._uuid import uuidv7
from .flags import (
    MISSING_INCONCLUSIVE,
    FlagContext,
    FlagDefinition,
    FlagValue,
    InconclusiveError,
    evaluate,
    items,
    parse_flag,
    record,
)
from .version import VERSION

__all__ = ["Tracemark", "FlagsAndPayloads", "Properties"]

logger = logging.getLogger("tracemark")

Properties = Mapping[str, Any]

MAX_BATCH = 1000
"""Most events in one ``POST /e`` request (the ingest limit)."""
MAX_BODY_BYTES = 4_500_000
"""Uncompressed batch size to stay under, below the ingest limit of 5 MB."""
MAX_EXPOSURES = 50_000
LIB = "tracemark-python"


@dataclass
class FlagsAndPayloads:
    flags: Dict[str, FlagValue]
    payloads: Dict[str, Any]


class _HTTPResult:
    def __init__(self, status: int, body: bytes) -> None:
        self.status = status
        self.body = body

    def json(self) -> Any:
        return json.loads(self.body.decode("utf-8"))

    def text(self) -> str:
        return self.body.decode("utf-8", "replace")


def _iso(moment: datetime) -> str:
    """RFC 3339 in UTC with milliseconds, like JavaScript's ``toISOString``. Naive datetimes are
    taken as local time, as everywhere else in Python."""
    utc = moment.astimezone(timezone.utc)
    return utc.strftime("%Y-%m-%dT%H:%M:%S.") + f"{utc.microsecond // 1000:03d}Z"


def _json_default(value: Any) -> Any:
    if isinstance(value, datetime):
        return _iso(value)
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, (set, frozenset, tuple)):
        return list(cast(Iterable[Any], value))
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace")
    return str(value)


def _dumps(value: Any) -> str:
    return json.dumps(value, default=_json_default, ensure_ascii=False, separators=(",", ":"))


def _same(a: Any, b: Any) -> bool:
    """Equality without Python's ``True == 1``, like JavaScript's ``===`` for flag values."""
    return type(a) is type(b) and a == b


def _value_text(value: FlagValue) -> str:
    if value is True:
        return "true"
    if value is False:
        return "false"
    return str(value)


class Tracemark:
    """A tracemark client for servers. Create one per process; :meth:`shutdown` runs at exit
    (or use the client as a context manager)."""

    def __init__(
        self,
        api_key: str,
        host: str,
        *,
        secret_key: Optional[str] = None,
        flush_at: int = 20,
        flush_interval: float = 10.0,
        flags_poll_interval: float = 30.0,
        max_queue_size: int = 10_000,
        request_timeout: float = 10.0,
        max_retries: int = 3,
        retry_backoff: float = 0.5,
        gzip: bool = True,
        on_error: Optional[Callable[[BaseException], None]] = None,
        release: Optional[str] = None,
    ) -> None:
        """
        :param api_key: Public project key (``fp_pub_…``), used to send events and ask for flags.
        :param host: Base URL of your tracemark instance. Events go to ``{host}/e``.
        :param secret_key: Secret project key (``fp_sec_…``). With it, flag definitions are fetched
            every ``flags_poll_interval`` seconds and flags are evaluated in-process.
        :param flush_at: Send once this many events are queued.
        :param flush_interval: Send queued events at least this often, in seconds.
        :param flags_poll_interval: How often to refresh flag definitions, in seconds.
        :param max_queue_size: Most events kept while the server can't be reached; the oldest
            are dropped.
        :param request_timeout: Timeout for each request, in seconds.
        :param max_retries: Retries of a batch after a network error, 429 or 5xx, before it is
            left queued for the next flush.
        :param retry_backoff: Wait before the first retry, in seconds; doubles each time.
        :param gzip: Compress event batches.
        :param on_error: Called with errors that would otherwise only be logged.
        :param release: Your app's version, sent as ``$release`` with exceptions.
        """
        if not api_key or not host:
            raise ValueError("tracemark needs api_key and host")
        self.api_key = api_key
        self.host = host.rstrip("/")
        self.secret_key = secret_key
        self.flush_at = max(1, flush_at)
        self.flush_interval = flush_interval
        self.flags_poll_interval = flags_poll_interval
        self.max_queue_size = max(1, max_queue_size)
        self.request_timeout = request_timeout
        self.max_retries = max(0, max_retries)
        self.retry_backoff = retry_backoff
        self.gzip = gzip
        self.on_error = on_error
        self.release = release

        # Queued events, each already serialized so a later change to a caller's dict can't
        # alter it and a value json can't encode can't break a whole batch.
        self._queue: Deque[str] = deque()
        self._queue_lock = threading.Lock()
        self._send_lock = threading.Lock()
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._closed = False

        self._definitions: Optional[List[FlagDefinition]] = None
        self._definitions_tried = threading.Event()
        self._exposed: Set[str] = set()
        self._exposed_lock = threading.Lock()

        self._opener = urllib.request.build_opener()
        self._consumer = threading.Thread(target=self._consume, name="tracemark-consumer", daemon=True)
        self._consumer.start()
        self._poller: Optional[threading.Thread] = None
        if secret_key:
            self._poller = threading.Thread(target=self._poll, name="tracemark-flags", daemon=True)
            self._poller.start()
        atexit.register(self.shutdown)

    # --- plumbing ---------------------------------------------------------------------------

    def _error(self, error: BaseException, level: int = logging.ERROR) -> None:
        logger.log(level, "tracemark: %s", error)
        if self.on_error is not None:
            try:
                self.on_error(error)
            except Exception:
                pass

    def _request(
        self,
        path: str,
        method: str = "GET",
        body: Optional[bytes] = None,
        headers: Optional[Dict[str, str]] = None,
    ) -> _HTTPResult:
        all_headers = {"user-agent": f"{LIB}/{VERSION}"}
        all_headers.update(headers or {})
        request = urllib.request.Request(f"{self.host}{path}", data=body, method=method, headers=all_headers)
        try:
            with self._opener.open(request, timeout=self.request_timeout) as response:
                return _HTTPResult(response.status, response.read())
        except urllib.error.HTTPError as error:
            try:
                content = error.read()
            except Exception:
                content = b""
            return _HTTPResult(error.code, content)

    # --- events -----------------------------------------------------------------------------

    def capture(
        self,
        distinct_id: str,
        event: str,
        properties: Optional[Properties] = None,
        groups: Optional[Mapping[str, str]] = None,
        timestamp: Optional[datetime] = None,
        set: Optional[Properties] = None,
        set_once: Optional[Properties] = None,
        uuid: Optional[str] = None,
    ) -> None:
        """Queues an event. Events are sent in batches; :meth:`flush` sends what's queued now.

        Never raises: an invalid event is dropped and reported to ``on_error``.
        """
        try:
            self._capture(distinct_id, event, properties, groups, timestamp, set, set_once, uuid)
        except Exception as error:
            self._error(error)

    def _capture(
        self,
        distinct_id: Any,
        event: Any,
        properties: Optional[Properties],
        groups: Optional[Mapping[str, str]],
        timestamp: Optional[datetime],
        set: Optional[Properties],
        set_once: Optional[Properties],
        uuid: Optional[str],
    ) -> None:
        if self._closed:
            return
        if not isinstance(distinct_id, str) or not distinct_id or len(distinct_id) > 200:
            self._error(ValueError(f"invalid distinct_id for {event}"), logging.WARNING)
            return
        if not isinstance(event, str) or not event or len(event) > 200:
            self._error(ValueError(f"invalid event name {event!r}"), logging.WARNING)
            return
        if timestamp is None:
            timestamp = datetime.now(timezone.utc)
        props: Dict[str, Any] = {"$lib": LIB, "$lib_version": VERSION}
        if properties:
            props.update(properties)
        wire: Dict[str, Any] = {
            "uuid": uuid or uuidv7(int(timestamp.timestamp() * 1000)),
            "event": event,
            "distinct_id": distinct_id,
            "timestamp": _iso(timestamp),
            "properties": props,
        }
        if set is not None or set_once is not None:
            person: Dict[str, Any] = {}
            if set is not None:
                person["set"] = dict(set)
            if set_once is not None:
                person["set_once"] = dict(set_once)
            wire["person"] = person
        if groups:
            wire["groups"] = dict(groups)
        line = _dumps(wire)
        with self._queue_lock:
            self._queue.append(line)
            while len(self._queue) > self.max_queue_size:
                self._queue.popleft()
            full = len(self._queue) >= self.flush_at
        if full:
            self._wake.set()

    def identify(
        self,
        distinct_id: str,
        set: Optional[Properties] = None,
        set_once: Optional[Properties] = None,
    ) -> None:
        """Sets person properties."""
        self.capture(distinct_id, "$set", set=set, set_once=set_once)

    def alias(self, distinct_id: str, alias: str) -> None:
        """Merges an earlier id (such as an anonymous browser id) into ``distinct_id``'s person."""
        self.capture(distinct_id, "$identify", properties={"$anon_distinct_id": alias})

    def group_identify(
        self,
        group_type: str,
        group_key: str,
        properties: Optional[Properties] = None,
        distinct_id: Optional[str] = None,
    ) -> None:
        """Sets a group's properties. The event is attributed to ``distinct_id``, by default
        ``$<type>_<key>``."""
        self.capture(
            distinct_id if distinct_id is not None else f"${group_type}_{group_key}",
            "$groupidentify",
            properties={
                "$group_type": group_type,
                "$group_key": group_key,
                "$group_set": dict(properties or {}),
            },
            groups={group_type: group_key},
        )

    def ai_score(
        self,
        distinct_id: str,
        trace_id: str,
        name: str,
        value: float,
        span_id: Optional[str] = None,
        comment: Optional[str] = None,
        properties: Optional[Properties] = None,
    ) -> None:
        """Records a score or piece of feedback for an AI trace, or one of its steps with
        ``span_id``, as a ``$ai_score`` event. ``name`` is what is scored, such as ``thumbs``;
        thumbs up and down are 1 and 0."""
        if isinstance(value, bool) or not isinstance(cast(Any, value), (int, float)) or not math.isfinite(value):
            self._error(ValueError(f"invalid score value {value!r}"), logging.WARNING)
            return
        props: Dict[str, Any] = dict(properties or {})
        props["$ai_trace_id"] = trace_id
        if span_id is not None:
            props["$ai_span_id"] = span_id
        props["$ai_score_name"] = name
        props["$ai_score_value"] = value
        if comment is not None:
            props["$ai_score_comment"] = comment
        self.capture(distinct_id, "$ai_score", properties=props)

    def capture_exception(
        self,
        error: Optional[BaseException] = None,
        distinct_id: Optional[str] = None,
        properties: Optional[Properties] = None,
        groups: Optional[Mapping[str, str]] = None,
        mechanism: str = "manual",
        handled: bool = True,
    ) -> None:
        """Captures an exception as a ``$exception`` event. Without ``error``, the exception
        being handled (inside an ``except`` block) is captured. Without ``distinct_id`` it is
        attributed to ``$server``."""
        try:
            if error is None:
                error = sys.exc_info()[1]
            if error is None:
                self._error(ValueError("capture_exception called without an exception"), logging.WARNING)
                return
            self._exception(error, distinct_id, properties, groups, mechanism, handled)
        except Exception as failure:
            self._error(failure)

    def _exception(
        self,
        error: BaseException,
        distinct_id: Optional[str],
        properties: Optional[Properties],
        groups: Optional[Mapping[str, str]],
        mechanism: str,
        handled: bool,
    ) -> None:
        props: Dict[str, Any] = dict(properties or {})
        props["$exception_list"] = exception_list(error, mechanism=mechanism, handled=handled)
        props["$exception_level"] = "error" if handled else "fatal"
        if self.release:
            props["$release"] = self.release
        self.capture(distinct_id or "$server", "$exception", properties=props, groups=groups)

    def capture_uncaught_exceptions(self) -> Callable[[], None]:
        """Captures exceptions nothing caught (``sys.excepthook`` and ``threading.excepthook``).
        One in the main thread is captured and sent before Python prints it and exits; one in
        another thread is captured and flushed. Returns a function that removes the hooks."""
        previous_sys = sys.excepthook
        previous_thread = threading.excepthook

        def on_exception(
            kind: Type[BaseException], value: BaseException, tb: Optional[TracebackType]
        ) -> None:
            if not issubclass(kind, KeyboardInterrupt):
                self._exception(value, None, None, None, "excepthook", False)
                self.shutdown()
            previous_sys(kind, value, tb)

        def on_thread_exception(args: Any) -> None:
            if args.exc_value is not None and not issubclass(args.exc_type, SystemExit):
                self._exception(args.exc_value, None, None, None, "threading.excepthook", False)
                self.flush()
            previous_thread(args)

        sys.excepthook = on_exception
        threading.excepthook = on_thread_exception

        def remove() -> None:
            if sys.excepthook is on_exception:
                sys.excepthook = previous_sys
            if threading.excepthook is on_thread_exception:
                threading.excepthook = previous_thread

        return remove

    def distinct_id_from_cookie(self, cookie_header: Optional[str]) -> Optional[str]:
        """The distinct id the browser SDK keeps in its cookie (with ``persistence: 'cookie'``),
        read from a request's ``Cookie`` header. ``None`` when there is none."""
        name = f"fp_{self.api_key}"
        for part in (cookie_header or "").split(";"):
            key, sep, value = part.partition("=")
            if not sep or key.strip() != name:
                continue
            try:
                parsed = json.loads(urllib.parse.unquote(value.strip()))
            except ValueError:
                return None
            found = (record(parsed) or {}).get("id")
            return found if isinstance(found, str) and found else None
        return None

    # --- sending ----------------------------------------------------------------------------

    def _consume(self) -> None:
        while not self._stop.is_set():
            self._wake.wait(self.flush_interval)
            self._wake.clear()
            if self._stop.is_set():
                break
            self.flush()

    def flush(self) -> None:
        """Sends everything queued now, blocking until done. A batch that keeps failing (network
        error, 429, 5xx) after ``max_retries`` stays queued for the next flush; one the server
        rejects (other 4xx) is dropped with a warning. Never raises."""
        try:
            with self._send_lock:
                while True:
                    batch = self._take()
                    if not batch:
                        return
                    if not self._send(batch):
                        self._requeue(batch)
                        return
        except Exception as error:  # pragma: no cover - defensive
            self._error(error)

    def _take(self) -> List[str]:
        with self._queue_lock:
            batch: List[str] = []
            size = 0
            while self._queue and len(batch) < MAX_BATCH:
                line = self._queue[0]
                if batch and size + len(line) > MAX_BODY_BYTES:
                    break
                batch.append(self._queue.popleft())
                size += len(line) + 1
            return batch

    def _requeue(self, batch: List[str]) -> None:
        with self._queue_lock:
            self._queue.extendleft(reversed(batch))
            while len(self._queue) > self.max_queue_size:
                self._queue.popleft()

    def _send(self, batch: List[str]) -> bool:
        """Sends one batch, retrying with backoff. True when it left the queue for good."""
        attempt = 0
        while True:
            prefix = _dumps({"api_key": self.api_key, "sent_at": _iso(datetime.now(timezone.utc))})
            raw = (prefix[:-1] + ',"batch":[' + ",".join(batch) + "]}").encode("utf-8")
            headers = {"content-type": "application/json"}
            body = raw
            if self.gzip:
                body = _gzip.compress(raw)
                headers["content-encoding"] = "gzip"
            failure: Optional[BaseException] = None
            try:
                result = self._request("/e", "POST", body, headers)
            except Exception as error:
                failure = error
            else:
                if result.status < 400:
                    return True
                if result.status != 429 and result.status < 500:
                    self._error(
                        RuntimeError(f"events rejected with HTTP {result.status}: {result.text()}"),
                        logging.WARNING,
                    )
                    return True
                failure = RuntimeError(f"sending events failed with HTTP {result.status}")
            if attempt >= self.max_retries:
                self._error(failure)
                return False
            logger.debug("tracemark: %s, retrying", failure)
            time.sleep(self.retry_backoff * (2**attempt))
            attempt += 1

    def shutdown(self) -> None:
        """Stops the background threads and sends what's queued. Called at exit; safe to call
        more than once."""
        if self._closed:
            return
        self._closed = True
        try:
            atexit.unregister(self.shutdown)
        except Exception:  # pragma: no cover
            pass
        self._stop.set()
        self._wake.set()
        if self._consumer.is_alive() and self._consumer is not threading.current_thread():
            self._consumer.join(self.request_timeout)
        self.flush()

    def __enter__(self) -> "Tracemark":
        return self

    def __exit__(
        self,
        exc_type: Optional[Type[BaseException]],
        exc: Optional[BaseException],
        tb: Optional[TracebackType],
    ) -> None:
        self.shutdown()

    # --- flags ------------------------------------------------------------------------------

    def _poll(self) -> None:
        while not self._stop.is_set():
            self.reload_feature_flags()
            self._stop.wait(self.flags_poll_interval)

    def reload_feature_flags(self) -> None:
        """Fetches flag definitions for local evaluation now. Needs ``secret_key``. If it fails,
        the last definitions are kept."""
        if not self.secret_key:
            return
        try:
            result = self._request("/flags/definitions", headers={"authorization": f"Bearer {self.secret_key}"})
            if result.status != 200:
                raise RuntimeError(f"loading flag definitions failed with HTTP {result.status}")
            body = record(result.json()) or {}
            definitions: List[FlagDefinition] = []
            for raw in items(body.get("flags")):
                try:
                    definitions.append(parse_flag(raw))
                except ValueError as error:
                    self._error(error, logging.WARNING)
            self._definitions = definitions
        except Exception as error:
            self._error(error)
        finally:
            self._definitions_tried.set()

    def _remote(
        self,
        distinct_id: str,
        person_properties: Optional[Properties],
        groups: Optional[Mapping[str, str]],
        group_properties: Optional[Mapping[str, Properties]],
    ) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        payload: Dict[str, Any] = {"api_key": self.api_key, "distinct_id": distinct_id}
        if person_properties is not None:
            payload["person_properties"] = person_properties
        if groups is not None:
            payload["groups"] = groups
        if group_properties is not None:
            payload["group_properties"] = group_properties
        result = self._request(
            "/flags", "POST", _dumps(payload).encode("utf-8"), {"content-type": "application/json"}
        )
        if result.status != 200:
            raise RuntimeError(f"evaluating flags failed with HTTP {result.status}")
        body = record(result.json()) or {}
        return record(body.get("flags")) or {}, record(body.get("payloads")) or {}

    def _decide(
        self,
        distinct_id: str,
        person_properties: Optional[Properties],
        groups: Optional[Mapping[str, str]],
        group_properties: Optional[Mapping[str, Properties]],
        only_local: bool,
        only: Optional[str] = None,
    ) -> FlagsAndPayloads:
        """Evaluates every flag, or only ``only``, locally where possible and remotely otherwise."""
        if self.secret_key and self._definitions is None:
            self._definitions_tried.wait(self.request_timeout)
        flags: Dict[str, FlagValue] = {}
        payloads: Dict[str, Any] = {}
        definitions = self._definitions
        need_server = definitions is None
        if definitions is not None:
            context = FlagContext(
                distinct_id=distinct_id,
                person_properties=person_properties or {},
                groups=groups or {},
                group_properties=group_properties or {},
            )
            for flag in definitions:
                if only is not None and flag.key != only:
                    continue
                try:
                    result = evaluate(flag, context, MISSING_INCONCLUSIVE)
                except InconclusiveError:
                    need_server = True
                    continue
                flags[flag.key] = result.value
                if result.payload is not None:
                    payloads[flag.key] = result.payload
        if need_server and not only_local:
            try:
                remote_flags, remote_payloads = self._remote(distinct_id, person_properties, groups, group_properties)
                # Locally decided values agree with the server's; the server fills in the rest.
                for key, value in remote_flags.items():
                    if key not in flags and isinstance(value, (bool, str)):
                        flags[key] = value
                for key, payload in remote_payloads.items():
                    if key not in payloads and key in remote_flags and _same(flags.get(key), remote_flags[key]):
                        payloads[key] = payload
            except Exception as error:
                self._error(error)
        return FlagsAndPayloads(flags=flags, payloads=payloads)

    def get_all_flags_and_payloads(
        self,
        distinct_id: str,
        person_properties: Optional[Properties] = None,
        groups: Optional[Mapping[str, str]] = None,
        group_properties: Optional[Mapping[str, Properties]] = None,
        only_local: bool = False,
    ) -> FlagsAndPayloads:
        """Every flag's value and payload for a person, without recording exposures. Flags are
        decided locally when possible; the rest are asked of the server in one request."""
        try:
            return self._decide(distinct_id, person_properties, groups, group_properties, only_local)
        except Exception as error:  # pragma: no cover - defensive
            self._error(error)
            return FlagsAndPayloads(flags={}, payloads={})

    def get_all_flags(
        self,
        distinct_id: str,
        person_properties: Optional[Properties] = None,
        groups: Optional[Mapping[str, str]] = None,
        group_properties: Optional[Mapping[str, Properties]] = None,
        only_local: bool = False,
    ) -> Dict[str, FlagValue]:
        """Every flag's value for a person, without recording exposures."""
        return self.get_all_flags_and_payloads(
            distinct_id, person_properties, groups, group_properties, only_local
        ).flags

    def _one(
        self,
        key: str,
        distinct_id: str,
        person_properties: Optional[Properties],
        groups: Optional[Mapping[str, str]],
        group_properties: Optional[Mapping[str, Properties]],
        send_exposure: bool,
        only_local: bool,
    ) -> Tuple[FlagValue, Any]:
        try:
            decided = self._decide(distinct_id, person_properties, groups, group_properties, only_local, key)
        except Exception as error:  # pragma: no cover - defensive
            self._error(error)
            return False, None
        value = decided.flags.get(key, False)
        if send_exposure:
            self._expose(key, value, distinct_id, groups)
        return value, (None if value is False else decided.payloads.get(key))

    def get_feature_flag(
        self,
        key: str,
        distinct_id: str,
        person_properties: Optional[Properties] = None,
        groups: Optional[Mapping[str, str]] = None,
        group_properties: Optional[Mapping[str, Properties]] = None,
        send_exposure: bool = True,
        only_local: bool = False,
    ) -> FlagValue:
        """A flag's value for a person: ``False`` when off, ``True`` or the variant when on."""
        return self._one(
            key, distinct_id, person_properties, groups, group_properties, send_exposure, only_local
        )[0]

    def is_feature_enabled(
        self,
        key: str,
        distinct_id: str,
        person_properties: Optional[Properties] = None,
        groups: Optional[Mapping[str, str]] = None,
        group_properties: Optional[Mapping[str, Properties]] = None,
        send_exposure: bool = True,
        only_local: bool = False,
    ) -> bool:
        """Whether a flag is on for a person."""
        return (
            self.get_feature_flag(
                key, distinct_id, person_properties, groups, group_properties, send_exposure, only_local
            )
            is not False
        )

    def get_feature_flag_payload(
        self,
        key: str,
        distinct_id: str,
        person_properties: Optional[Properties] = None,
        groups: Optional[Mapping[str, str]] = None,
        group_properties: Optional[Mapping[str, Properties]] = None,
        send_exposure: bool = True,
        only_local: bool = False,
    ) -> Any:
        """The JSON payload served with a flag's current value for a person; ``None`` when the
        flag is off or has none."""
        return self._one(
            key, distinct_id, person_properties, groups, group_properties, send_exposure, only_local
        )[1]

    def _expose(
        self, key: str, value: FlagValue, distinct_id: str, groups: Optional[Mapping[str, str]]
    ) -> None:
        seen = f"{distinct_id}\0{key}\0{_value_text(value)}"
        with self._exposed_lock:
            if seen in self._exposed:
                return
            if len(self._exposed) >= MAX_EXPOSURES:
                self._exposed.clear()
            self._exposed.add(seen)
        self.capture(
            distinct_id,
            "$feature_flag_called",
            properties={"$feature_flag": key, "$feature_flag_response": value},
            groups=groups,
        )

