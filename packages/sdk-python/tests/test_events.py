"""Capturing and sending events: wire format, batching, flushing, retries and failures."""

from __future__ import annotations

import logging
import re
import threading
import unittest
from datetime import datetime, timedelta, timezone
from typing import Any, List

from _support import FakeServer, batch_errors, closed_port_url, fixtures

from footprint import VERSION, Footprint
from footprint._uuid import uuidv7

UUID7 = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")


class SchemaRules(unittest.TestCase):
    """The checker the SDK's output is held to agrees with the shared fixtures."""

    def test_accepts_every_valid_fixture(self) -> None:
        for name, body in fixtures("valid"):
            with self.subTest(name):
                self.assertEqual(batch_errors(body), [])

    def test_rejects_every_invalid_fixture(self) -> None:
        cases = fixtures("invalid")
        self.assertGreater(len(cases), 0)
        for name, body in cases:
            with self.subTest(name):
                self.assertNotEqual(batch_errors(body), [])


class ClientTest(unittest.TestCase):
    def setUp(self) -> None:
        self.server = FakeServer()
        self.clients: List[Footprint] = []

    def tearDown(self) -> None:
        for client in self.clients:
            client.shutdown()
        self.server.close()

    def client(self, **options: Any) -> Footprint:
        settings: Any = {"flush_interval": 60.0, "retry_backoff": 0.01}
        settings.update(options)
        host = settings.pop("host", self.server.url)
        client = Footprint("fp_pub_test", host + "/", **settings)
        self.clients.append(client)
        return client


class WireFormat(ClientTest):
    def test_sends_events_in_the_ingest_wire_format(self) -> None:
        fp = self.client()
        moment = datetime(2026, 10, 7, 22, 59, 58, 120_000, tzinfo=timezone(timedelta(hours=2)))
        fp.capture(
            "user_123",
            "invoice_paid",
            properties={"amount": 49, "when": moment, "tags": ("a", "b")},
            groups={"company": "acme"},
            timestamp=moment,
            set={"plan": "pro"},
            set_once={"first_seen_on": "server"},
        )
        fp.identify("user_123", set={"plan": "team"})
        fp.alias("user_123", "anon_1")
        fp.group_identify("company", "acme", {"seats": 40})
        fp.capture("user_123", "plain")
        fp.flush()

        requests = self.server.to("/e")
        self.assertEqual(len(requests), 1)
        request = requests[0]
        self.assertEqual(request.method, "POST")
        self.assertEqual(request.headers["content-type"], "application/json")
        self.assertEqual(request.headers["content-encoding"], "gzip")
        self.assertEqual(batch_errors(request.body), [])
        self.assertEqual(request.body["api_key"], "fp_pub_test")
        self.assertRegex(request.body["sent_at"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$")

        paid, identify, alias, group, plain = request.body["batch"]
        self.assertRegex(paid["uuid"], UUID7)
        self.assertEqual(paid["event"], "invoice_paid")
        self.assertEqual(paid["distinct_id"], "user_123")
        self.assertEqual(paid["timestamp"], "2026-10-07T20:59:58.120Z")
        self.assertEqual(
            paid["properties"],
            {
                "$lib": "footprint-python",
                "$lib_version": VERSION,
                "amount": 49,
                "when": "2026-10-07T20:59:58.120Z",
                "tags": ["a", "b"],
            },
        )
        self.assertEqual(paid["person"], {"set": {"plan": "pro"}, "set_once": {"first_seen_on": "server"}})
        self.assertEqual(paid["groups"], {"company": "acme"})

        self.assertEqual(identify["event"], "$set")
        self.assertEqual(identify["person"], {"set": {"plan": "team"}})

        self.assertEqual(alias["event"], "$identify")
        self.assertEqual(alias["distinct_id"], "user_123")
        self.assertEqual(alias["properties"]["$anon_distinct_id"], "anon_1")

        self.assertEqual(group["event"], "$groupidentify")
        self.assertEqual(group["distinct_id"], "$company_acme")
        self.assertEqual(group["groups"], {"company": "acme"})
        self.assertEqual(group["properties"]["$group_type"], "company")
        self.assertEqual(group["properties"]["$group_key"], "acme")
        self.assertEqual(group["properties"]["$group_set"], {"seats": 40})

        self.assertNotIn("person", plain)
        self.assertNotIn("groups", plain)
        self.assertEqual(len({e["uuid"] for e in request.body["batch"]}), 5)

    def test_without_gzip(self) -> None:
        fp = self.client(gzip=False)
        fp.capture("u", "e")
        fp.flush()
        request = self.server.to("/e")[0]
        self.assertNotIn("content-encoding", request.headers)
        self.assertEqual(request.body["batch"][0]["event"], "e")

    def test_snapshots_properties_at_capture_time(self) -> None:
        fp = self.client()
        properties = {"step": 1}
        fp.capture("u", "e", properties)
        properties["step"] = 2
        fp.flush()
        self.assertEqual(self.server.events()[0]["properties"]["step"], 1)

    def test_naive_timestamps_are_local_time(self) -> None:
        fp = self.client()
        naive = datetime(2026, 1, 2, 3, 4, 5)
        fp.capture("u", "e", timestamp=naive)
        fp.flush()
        expected = naive.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
        self.assertEqual(self.server.events()[0]["timestamp"], expected)

    def test_skips_invalid_events_without_raising(self) -> None:
        errors: List[BaseException] = []
        fp = self.client(on_error=errors.append)
        with self.assertLogs("footprint", logging.WARNING):
            fp.capture("", "e")
            fp.capture("u", "")
            fp.capture("u", "x" * 201)
            fp.capture("x" * 201, "e")
            fp.capture(None, "e")  # type: ignore[arg-type]
            fp.capture("u", "e", properties=["not", "a", "dict"])  # type: ignore[arg-type]
        fp.capture("u", "ok")
        fp.flush()
        self.assertEqual([e["event"] for e in self.server.events()], ["ok"])
        self.assertEqual(len(errors), 6)

    def test_uuid_v7_is_ordered(self) -> None:
        ids = [uuidv7(1_700_000_000_000) for _ in range(5000)]
        for value in ids:
            self.assertRegex(value, UUID7)
        self.assertEqual(ids, sorted(ids))
        now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
        embedded = int(uuidv7().replace("-", "")[:12], 16)
        self.assertLess(abs(embedded - now_ms), 5000)


class Batching(ClientTest):
    def test_sends_on_its_own_once_flush_at_events_are_queued(self) -> None:
        fp = self.client(flush_at=3)
        fp.capture("u", "a")
        fp.capture("u", "b")
        self.assertEqual(self.server.to("/e"), [])
        fp.capture("u", "c")
        self.assertTrue(self.server.wait_for(lambda: len(self.server.events()) == 3))
        self.assertEqual(len(self.server.to("/e")), 1)

    def test_sends_every_flush_interval(self) -> None:
        fp = self.client(flush_interval=0.05)
        fp.capture("u", "a")
        self.assertTrue(self.server.wait_for(lambda: len(self.server.events()) == 1))

    def test_splits_into_batches_of_at_most_1000(self) -> None:
        fp = self.client(flush_at=100_000, max_queue_size=100_000)
        for i in range(2500):
            fp.capture("u", f"e{i}")
        fp.flush()
        sizes = [len(r.body["batch"]) for r in self.server.to("/e")]
        self.assertEqual(sizes, [1000, 1000, 500])
        self.assertEqual([e["event"] for e in self.server.events()], [f"e{i}" for i in range(2500)])
        for request in self.server.to("/e"):
            self.assertEqual(batch_errors(request.body), [])

    def test_caps_the_queue_dropping_the_oldest(self) -> None:
        fp = self.client(max_queue_size=3)
        for i in range(5):
            fp.capture("u", f"e{i}")
        fp.flush()
        self.assertEqual([e["event"] for e in self.server.events()], ["e2", "e3", "e4"])

    def test_flush_with_nothing_queued_sends_nothing(self) -> None:
        fp = self.client()
        fp.flush()
        self.assertEqual(self.server.requests, [])

    def test_concurrent_captures_all_arrive_once(self) -> None:
        fp = self.client(flush_at=50)

        def work(n: int) -> None:
            for i in range(200):
                fp.capture(f"user_{n}", f"e{i}")

        threads = [threading.Thread(target=work, args=(n,)) for n in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        fp.flush()
        uuids = [e["uuid"] for e in self.server.events()]
        self.assertEqual(len(uuids), 1600)
        self.assertEqual(len(set(uuids)), 1600)


class Failures(ClientTest):
    def test_retries_503_with_backoff_then_sends(self) -> None:
        self.server.script("/e", (503, {"error": "not_ready"}), (503, {"error": "overloaded"}))
        fp = self.client(max_retries=3)
        fp.capture("u", "a")
        fp.flush()
        attempts = self.server.to("/e")
        self.assertEqual(len(attempts), 3)
        self.assertEqual([r.body["batch"][0]["uuid"] for r in attempts], [attempts[0].body["batch"][0]["uuid"]] * 3)
        fp.capture("u", "b")
        fp.flush()
        self.assertEqual(len(self.server.to("/e")), 4)

    def test_keeps_events_queued_when_retries_run_out(self) -> None:
        self.server.script("/e", *[(500, {"error": "boom"})] * 2, (429, {}))
        errors: List[BaseException] = []
        fp = self.client(max_retries=2, on_error=errors.append)
        fp.capture("u", "a")
        with self.assertLogs("footprint", logging.ERROR):
            fp.flush()
        self.assertEqual(len(self.server.to("/e")), 3)
        self.assertEqual(len(errors), 1)
        self.assertIn("429", str(errors[0]))
        fp.capture("u", "b")
        fp.flush()
        last = self.server.to("/e")[-1]
        self.assertEqual([e["event"] for e in last.body["batch"]], ["a", "b"])

    def test_drops_a_batch_the_server_rejects_with_a_warning(self) -> None:
        self.server.script("/e", (400, {"error": "invalid_batch"}))
        errors: List[BaseException] = []
        fp = self.client(on_error=errors.append)
        fp.capture("u", "a")
        with self.assertLogs("footprint", logging.WARNING) as logs:
            fp.flush()
        self.assertIn("HTTP 400", "\n".join(logs.output))
        self.assertIn("invalid_batch", str(errors[0]))
        fp.capture("u", "b")
        fp.flush()
        last = self.server.to("/e")[-1]
        self.assertEqual([e["event"] for e in last.body["batch"]], ["b"])

    def test_never_raises_when_the_server_cannot_be_reached(self) -> None:
        errors: List[BaseException] = []
        fp = self.client(host=closed_port_url(), max_retries=1, on_error=errors.append)
        fp.capture("u", "a")
        with self.assertLogs("footprint", logging.ERROR):
            fp.flush()
            fp.shutdown()
        self.assertGreaterEqual(len(errors), 1)

    def test_an_on_error_that_raises_is_ignored(self) -> None:
        def explode(error: BaseException) -> None:
            raise RuntimeError("callback failed")

        self.server.script("/e", (401, {"error": "invalid_api_key"}))
        fp = self.client(on_error=explode)
        fp.capture("u", "a")
        with self.assertLogs("footprint", logging.WARNING):
            fp.flush()


class Lifecycle(ClientTest):
    def test_shutdown_sends_what_is_left_and_nothing_after(self) -> None:
        fp = self.client()
        fp.capture("u", "a")
        fp.shutdown()
        self.assertEqual([e["event"] for e in self.server.events()], ["a"])
        fp.capture("u", "b")
        fp.flush()
        fp.shutdown()
        self.assertEqual(len(self.server.events()), 1)
        self.assertFalse(fp._consumer.is_alive())

    def test_context_manager_shuts_down(self) -> None:
        with Footprint("fp_pub_test", self.server.url, flush_interval=60) as fp:
            fp.capture("u", "a")
        self.assertEqual(len(self.server.events()), 1)
        self.assertTrue(fp._closed)

    def test_needs_api_key_and_host(self) -> None:
        with self.assertRaises(ValueError):
            Footprint("", "http://x")
        with self.assertRaises(ValueError):
            Footprint("fp_pub_test", "")


if __name__ == "__main__":
    unittest.main()
