"""capture_exception and the $exception event's properties."""

from __future__ import annotations

import logging
import os
import sys
import threading
import unittest
from typing import Any, Dict, List

from _support import FakeServer, batch_errors

from tracemark import Tracemark
from tracemark._exceptions import MAX_CAUSES, in_app


class CheckoutError(Exception):
    pass


def load_cart() -> None:
    raise KeyError("total")


def checkout() -> None:
    try:
        load_cart()
    except KeyError as error:
        raise CheckoutError("cart not loaded") from error


class ExceptionsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.server = FakeServer()
        self.fp = Tracemark("fp_pub_test", self.server.url, flush_interval=60, release="1.4.0")

    def tearDown(self) -> None:
        self.fp.shutdown()
        self.server.close()

    def sent(self) -> List[Dict[str, Any]]:
        self.fp.flush()
        for request in self.server.to("/e"):
            self.assertEqual(batch_errors(request.body), [])
        return self.server.events()

    def test_captures_the_exception_and_its_cause(self) -> None:
        try:
            checkout()
        except CheckoutError as error:
            self.fp.capture_exception(
                error, distinct_id="user_123", properties={"route": "/checkout"}, groups={"company": "acme"}
            )
        (event,) = self.sent()
        self.assertEqual(event["event"], "$exception")
        self.assertEqual(event["distinct_id"], "user_123")
        self.assertEqual(event["groups"], {"company": "acme"})
        props = event["properties"]
        self.assertEqual(props["route"], "/checkout")
        self.assertEqual(props["$release"], "1.4.0")
        self.assertEqual(props["$exception_level"], "error")
        self.assertEqual(props["$lib"], "tracemark-python")

        first, cause = props["$exception_list"]
        self.assertEqual(first["type"], "CheckoutError")
        self.assertEqual(first["value"], "cart not loaded")
        self.assertEqual(first["mechanism"], {"type": "manual", "handled": True})
        self.assertEqual(cause["type"], "KeyError")
        self.assertEqual(cause["value"], "'total'")

        # Innermost first: frames[0] is where it was raised.
        frames = cause["stacktrace"]["frames"]
        self.assertEqual(frames[0]["function"], "load_cart")
        self.assertEqual(frames[1]["function"], "checkout")
        self.assertEqual(first["stacktrace"]["frames"][0]["function"], "checkout")
        for frame in frames:
            self.assertEqual(set(frame) - {"filename", "function", "lineno", "colno", "in_app"}, set())
            self.assertIsInstance(frame["lineno"], int)
        self.assertEqual(frames[0]["filename"], __file__)
        self.assertTrue(frames[0]["in_app"])

    def test_captures_the_exception_being_handled(self) -> None:
        try:
            {}["missing"]
        except KeyError:
            self.fp.capture_exception()
        (event,) = self.sent()
        self.assertEqual(event["distinct_id"], "$server")
        self.assertEqual(event["properties"]["$exception_list"][0]["type"], "KeyError")

    def test_follows_implicit_context_but_not_suppressed_context(self) -> None:
        try:
            try:
                raise ValueError("first")
            except ValueError:
                raise RuntimeError("second")
        except RuntimeError as error:
            self.fp.capture_exception(error)
        try:
            try:
                raise ValueError("hidden")
            except ValueError:
                raise RuntimeError("alone") from None
        except RuntimeError as error:
            self.fp.capture_exception(error)
        chained, alone = self.sent()
        self.assertEqual([e["value"] for e in chained["properties"]["$exception_list"]], ["second", "first"])
        self.assertEqual([e["value"] for e in alone["properties"]["$exception_list"]], ["alone"])

    def test_caps_the_cause_chain_and_survives_cycles(self) -> None:
        errors = [ValueError(str(i)) for i in range(10)]
        for a, b in zip(errors, errors[1:]):
            a.__cause__ = b
        loop_a, loop_b = ValueError("a"), ValueError("b")
        loop_a.__cause__ = loop_b
        loop_b.__cause__ = loop_a
        self.fp.capture_exception(errors[0])
        self.fp.capture_exception(loop_a)
        long, looped = self.sent()
        self.assertEqual(len(long["properties"]["$exception_list"]), MAX_CAUSES + 1)
        self.assertEqual([e["value"] for e in looped["properties"]["$exception_list"]], ["a", "b"])

    def test_an_exception_never_raised_has_no_stacktrace(self) -> None:
        self.fp.capture_exception(ValueError("x" * 3000), mechanism="worker", handled=False)
        (event,) = self.sent()
        entry = event["properties"]["$exception_list"][0]
        self.assertNotIn("stacktrace", entry)
        self.assertEqual(len(entry["value"]), 2000)
        self.assertEqual(entry["mechanism"], {"type": "worker", "handled": False})
        self.assertEqual(event["properties"]["$exception_level"], "fatal")

    def test_without_any_exception_nothing_is_sent(self) -> None:
        with self.assertLogs("tracemark", logging.WARNING):
            self.fp.capture_exception()
        self.assertEqual(self.sent(), [])

    def test_library_frames_are_not_in_app(self) -> None:
        self.assertFalse(in_app(os.__file__))
        self.assertFalse(in_app("/srv/app/.venv/lib/python3.12/site-packages/django/core.py"))
        self.assertFalse(in_app("<frozen importlib._bootstrap>"))
        self.assertTrue(in_app(__file__))

    def test_uncaught_exceptions_in_threads_are_captured(self) -> None:
        original = threading.excepthook
        remove = self.fp.capture_uncaught_exceptions()
        try:
            # Keep the default hook from printing the traceback into the test output.
            quiet = sys.stderr
            sys.stderr = open(os.devnull, "w")
            try:
                thread = threading.Thread(target=load_cart)
                thread.start()
                thread.join()
            finally:
                sys.stderr.close()
                sys.stderr = quiet
        finally:
            remove()
        self.assertIs(threading.excepthook, original)
        events = self.server.events()
        self.assertEqual(len(events), 1)
        entry = events[0]["properties"]["$exception_list"][0]
        self.assertEqual(entry["mechanism"], {"type": "threading.excepthook", "handled": False})
        self.assertEqual(events[0]["properties"]["$exception_level"], "fatal")


if __name__ == "__main__":
    unittest.main()
