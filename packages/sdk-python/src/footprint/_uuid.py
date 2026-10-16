"""RFC 9562 UUIDv7, the same layout as the Node SDK's ``uuid.ts``."""

from __future__ import annotations

import os
import threading
import time
from typing import Optional

_lock = threading.Lock()
_last_ms = 0
_counter = 0


def uuidv7(now_ms: Optional[int] = None) -> str:
    """48-bit unix ms timestamp, version 7, 12-bit counter in ``rand_a`` (monotonic within one
    millisecond), variant 10, 62 random bits. If the counter overflows the timestamp is advanced
    by 1 ms so ordering holds."""
    global _last_ms, _counter
    if now_ms is None:
        now_ms = time.time_ns() // 1_000_000
    b = bytearray(os.urandom(16))
    with _lock:
        if now_ms > _last_ms:
            _last_ms = now_ms
            # Random start, top bit clear, leaves headroom for increments.
            _counter = ((b[6] << 8) | b[7]) & 0x7FF
        else:
            _counter += 1
            if _counter > 0xFFF:
                _last_ms += 1
                _counter = 0
        ms = _last_ms
        counter = _counter
    b[0:6] = ms.to_bytes(6, "big")
    b[6] = 0x70 | (counter >> 8)
    b[7] = counter & 0xFF
    b[8] = 0x80 | (b[8] & 0x3F)
    h = b.hex()
    return f"{h[0:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:32]}"
