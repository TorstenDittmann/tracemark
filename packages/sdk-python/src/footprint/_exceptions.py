"""Turns exceptions into the ``$exception`` event's ``$exception_list`` (see docs/errors.md),
mirroring ``packages/errors``."""

from __future__ import annotations

import json
import os
import sysconfig
import traceback
from types import TracebackType
from typing import Any, Dict, List, Optional, Set

MAX_FRAMES = 50
"""Frames kept per exception, innermost first."""
MAX_CAUSES = 4
"""Exceptions linked through ``__cause__`` / ``__context__`` kept after the first."""
MAX_VALUE = 2000


def _library_dirs() -> List[str]:
    dirs: Set[str] = set()
    for name in ("stdlib", "platstdlib", "purelib", "platlib"):
        try:
            path = sysconfig.get_paths().get(name)
        except Exception:  # pragma: no cover - broken sysconfig
            path = None
        if path:
            dirs.add(os.path.normcase(os.path.realpath(path)))
    return sorted(dirs)


_LIBRARY_DIRS = _library_dirs()


def in_app(filename: str) -> bool:
    """Whether a frame is the app's own code: not the standard library, an installed package or
    frozen/built-in code."""
    if not filename or filename.startswith("<"):
        return False
    parts = filename.replace("\\", "/").split("/")
    if "site-packages" in parts or "dist-packages" in parts:
        return False
    path = os.path.normcase(os.path.realpath(filename))
    return not any(path == d or path.startswith(d + os.sep) for d in _LIBRARY_DIRS)


def _frames(tb: Optional[TracebackType]) -> List[Dict[str, Any]]:
    if tb is None:
        return []
    frames: List[Dict[str, Any]] = []
    for summary in reversed(traceback.extract_tb(tb)):
        frame: Dict[str, Any] = {"filename": summary.filename}
        if summary.name and summary.name != "<module>":
            frame["function"] = summary.name
        if summary.lineno is not None:
            frame["lineno"] = summary.lineno
        colno = getattr(summary, "colno", None)  # Python 3.11+, 0-based
        if isinstance(colno, int):
            frame["colno"] = colno + 1
        frame["in_app"] = in_app(summary.filename)
        frames.append(frame)
        if len(frames) == MAX_FRAMES:
            break
    return frames


def _describe(value: Any) -> Dict[str, Any]:
    if isinstance(value, BaseException):
        return {"type": type(value).__name__, "value": str(value), "tb": value.__traceback__}
    if isinstance(value, str):
        return {"type": "Error", "value": value, "tb": None}
    try:
        text = json.dumps(value)
    except (TypeError, ValueError):
        text = repr(value)
    return {"type": "Error", "value": f"Non-Error thrown: {text}", "tb": None}


def _cause(value: Any) -> Any:
    if not isinstance(value, BaseException):
        return None
    if value.__cause__ is not None:
        return value.__cause__
    if not value.__suppress_context__:
        return value.__context__
    return None


def exception_list(error: Any, mechanism: str = "manual", handled: bool = True) -> List[Dict[str, Any]]:
    """The ``$exception_list`` for an exception: the exception itself, then its causes."""
    mech = {"type": mechanism, "handled": handled}
    result: List[Dict[str, Any]] = []
    seen: List[int] = []
    current: Any = error
    while len(result) <= MAX_CAUSES and id(current) not in seen:
        seen.append(id(current))
        described = _describe(current)
        entry: Dict[str, Any] = {
            "type": described["type"],
            "value": described["value"][:MAX_VALUE],
            "mechanism": dict(mech),
        }
        frames = _frames(described["tb"])
        if frames:
            entry["stacktrace"] = {"frames": frames}
        result.append(entry)
        current = _cause(current)
        if current is None:
            break
    return result
