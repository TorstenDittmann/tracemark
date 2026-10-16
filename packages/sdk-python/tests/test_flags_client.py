"""Feature flags through the client: remote and local evaluation, fallbacks and exposures."""

from __future__ import annotations

import logging
import unittest
from typing import Any, Dict, List

from _support import VECTORS, FakeServer, Recorded, batch_errors, load_json

from footprint import Footprint

VECTOR_DATA = load_json(VECTORS)
DEFINITIONS = [group["flag"] for group in VECTOR_DATA["flags"]]


def remote_answer(request: Recorded) -> Any:
    return (
        200,
        {
            "flags": {"new-checkout": True, "pricing": "test", "beta": False, "vip": True, "server-only": "b"},
            "payloads": {"pricing": {"price": 9}, "vip": {"perk": "lounge"}, "server-only": [1]},
        },
    )


class FlagsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.server = FakeServer()
        self.server.on("/flags", remote_answer)
        self.server.on("/flags/definitions", (200, {"flags": DEFINITIONS}))
        self.clients: List[Footprint] = []

    def tearDown(self) -> None:
        for client in self.clients:
            client.shutdown()
        self.server.close()

    def client(self, **options: Any) -> Footprint:
        settings: Dict[str, Any] = {"flush_interval": 60.0, "retry_backoff": 0.01}
        settings.update(options)
        client = Footprint("fp_pub_test", self.server.url, **settings)
        self.clients.append(client)
        return client

    def exposures(self) -> List[Dict[str, Any]]:
        return [e for e in self.server.events() if e["event"] == "$feature_flag_called"]


class Remote(FlagsTest):
    def test_asks_the_server_without_a_secret_key(self) -> None:
        fp = self.client()
        value = fp.get_feature_flag(
            "pricing",
            "user_123",
            person_properties={"plan": "pro"},
            groups={"company": "acme"},
            group_properties={"company": {"seats": 40}},
        )
        self.assertEqual(value, "test")
        request = self.server.to("/flags")[0]
        self.assertEqual(request.method, "POST")
        self.assertEqual(request.headers["content-type"], "application/json")
        self.assertEqual(
            request.body,
            {
                "api_key": "fp_pub_test",
                "distinct_id": "user_123",
                "person_properties": {"plan": "pro"},
                "groups": {"company": "acme"},
                "group_properties": {"company": {"seats": 40}},
            },
        )
        self.assertEqual(self.server.to("/flags/definitions"), [])

    def test_leaves_out_what_was_not_given(self) -> None:
        fp = self.client()
        fp.get_all_flags("user_123")
        self.assertEqual(self.server.to("/flags")[0].body, {"api_key": "fp_pub_test", "distinct_id": "user_123"})

    def test_values_and_payloads(self) -> None:
        fp = self.client()
        self.assertTrue(fp.is_feature_enabled("new-checkout", "u"))
        self.assertFalse(fp.is_feature_enabled("beta", "u"))
        self.assertFalse(fp.is_feature_enabled("missing", "u"))
        self.assertIs(fp.get_feature_flag("missing", "u"), False)
        self.assertEqual(fp.get_feature_flag_payload("pricing", "u"), {"price": 9})
        self.assertIsNone(fp.get_feature_flag_payload("beta", "u"))
        everything = fp.get_all_flags_and_payloads("u")
        self.assertEqual(everything.flags["server-only"], "b")
        self.assertEqual(everything.payloads["vip"], {"perk": "lounge"})

    def test_a_failing_server_reads_as_off_without_raising(self) -> None:
        self.server.on("/flags", (500, {"error": "boom"}))
        errors: List[BaseException] = []
        fp = self.client(on_error=errors.append)
        with self.assertLogs("footprint", logging.ERROR):
            self.assertIs(fp.get_feature_flag("pricing", "u"), False)
            self.assertEqual(fp.get_all_flags("u"), {})
        self.assertEqual(len(errors), 2)


class Local(FlagsTest):
    def test_evaluates_locally_with_a_secret_key(self) -> None:
        fp = self.client(secret_key="fp_sec_test")
        self.assertIs(fp.get_feature_flag("new-checkout", "grace"), True)
        self.assertIs(fp.get_feature_flag("new-checkout", "ada"), False)
        self.assertEqual(
            fp.get_feature_flag("pricing", "ada", person_properties={"email": "ada@example.com"}), "test"
        )
        self.assertEqual(fp.get_feature_flag_payload("new-checkout", "grace"), {"color": "green"})
        self.assertEqual(self.server.to("/flags"), [])
        definitions = self.server.to("/flags/definitions")
        self.assertEqual(definitions[0].headers["authorization"], "Bearer fp_sec_test")

    def test_asks_the_server_only_when_local_evaluation_is_inconclusive(self) -> None:
        fp = self.client(secret_key="fp_sec_test")
        # The staff override needs `email`, which wasn't given: the server decides.
        self.assertEqual(fp.get_feature_flag("pricing", "ada"), "test")
        self.assertEqual(len(self.server.to("/flags")), 1)
        # Cohorts are never known locally.
        self.assertIs(fp.get_feature_flag("vip", "ada"), True)
        self.assertEqual(len(self.server.to("/flags")), 2)
        self.assertEqual(fp.get_feature_flag_payload("vip", "ada"), {"perk": "lounge"})

    def test_get_all_flags_merges_local_and_remote(self) -> None:
        fp = self.client(secret_key="fp_sec_test")
        result = fp.get_all_flags_and_payloads("ada", person_properties={"plan": "pro", "seats": 3})
        # Decided locally (ada is out of the 70% rollout), even though the server says True.
        self.assertIs(result.flags["new-checkout"], False)
        self.assertNotIn("new-checkout", result.payloads)
        # Inconclusive locally, so filled in from the server.
        self.assertIs(result.flags["vip"], True)
        self.assertEqual(result.payloads["vip"], {"perk": "lounge"})
        self.assertEqual(result.flags["server-only"], "b")
        # Local: pricing stays local because email is missing -> inconclusive -> server value.
        self.assertEqual(result.flags["pricing"], "test")
        self.assertIs(result.flags["pro-only"], False)
        self.assertEqual(len(self.server.to("/flags")), 1)

    def test_only_local_never_asks_the_server(self) -> None:
        fp = self.client(secret_key="fp_sec_test")
        self.assertIs(fp.get_feature_flag("vip", "ada", only_local=True), False)
        flags = fp.get_all_flags("ada", only_local=True)
        self.assertNotIn("vip", flags)
        self.assertIs(flags["new-checkout"], False)
        self.assertEqual(self.server.to("/flags"), [])

    def test_shared_vectors_through_the_client(self) -> None:
        fp = self.client(secret_key="fp_sec_test", flags_poll_interval=60)
        fp.reload_feature_flags()
        for group in VECTOR_DATA["flags"]:
            for case in group["cases"]:
                context = case["context"]
                if "cohorts" in context or case.get("missing") == "inconclusive":
                    continue  # the client can't be given cohorts and always reads missing as inconclusive
                expected = case["expected"]
                if expected == "inconclusive":
                    continue
                with self.subTest(flag=group["name"], context=context):
                    before = len(self.server.to("/flags"))
                    value = fp.get_feature_flag(
                        group["flag"]["key"],
                        context["distinctId"],
                        person_properties=context.get("personProperties"),
                        groups=context.get("groups"),
                        group_properties=context.get("groupProperties"),
                        send_exposure=False,
                    )
                    asked = len(self.server.to("/flags")) > before
                    if not asked:
                        self.assertEqual(value, expected["value"])

    def test_keeps_the_last_definitions_when_a_refresh_fails(self) -> None:
        fp = self.client(secret_key="fp_sec_test", flags_poll_interval=60)
        self.assertIs(fp.get_feature_flag("new-checkout", "grace"), True)
        self.server.on("/flags/definitions", (500, {"error": "boom"}))
        with self.assertLogs("footprint", logging.ERROR):
            fp.reload_feature_flags()
        self.assertIs(fp.get_feature_flag("new-checkout", "grace"), True)
        self.assertEqual(self.server.to("/flags"), [])

    def test_polls_definitions(self) -> None:
        self.client(secret_key="fp_sec_test", flags_poll_interval=0.05)
        self.assertTrue(self.server.wait_for(lambda: len(self.server.to("/flags/definitions")) >= 3))

    def test_skips_definitions_that_do_not_parse(self) -> None:
        self.server.on("/flags/definitions", (200, {"flags": [{"key": "!bad"}, DEFINITIONS[0]]}))
        with self.assertLogs("footprint", logging.WARNING):
            fp = self.client(secret_key="fp_sec_test")
            self.assertIs(fp.get_feature_flag("new-checkout", "grace"), True)

    def test_falls_back_to_the_server_when_definitions_never_load(self) -> None:
        self.server.on("/flags/definitions", (401, {"error": "invalid_secret_key"}))
        with self.assertLogs("footprint", logging.ERROR):
            fp = self.client(secret_key="fp_sec_wrong")
            self.assertIs(fp.get_feature_flag("new-checkout", "ada"), True)
        self.assertEqual(len(self.server.to("/flags")), 1)


class Exposures(FlagsTest):
    def test_records_an_exposure_once_per_person_and_value(self) -> None:
        fp = self.client(secret_key="fp_sec_test")
        fp.get_feature_flag("new-checkout", "grace")
        fp.is_feature_enabled("new-checkout", "grace")
        fp.get_feature_flag_payload("new-checkout", "grace")
        fp.get_feature_flag("new-checkout", "ada")
        fp.get_feature_flag("pricing", "ada", person_properties={"email": "a@example.com"})
        fp.get_feature_flag("pricing", "ada", person_properties={"email": "a@other.com"}, groups={"company": "acme"})
        fp.get_feature_flag("new-checkout", "eve", send_exposure=False)
        fp.get_all_flags("bob")
        fp.flush()
        exposures = self.exposures()
        seen = [
            (e["distinct_id"], e["properties"]["$feature_flag"], e["properties"]["$feature_flag_response"])
            for e in exposures
        ]
        self.assertEqual(
            seen,
            [
                ("grace", "new-checkout", True),
                ("ada", "new-checkout", False),
                ("ada", "pricing", "test"),
                ("ada", "pricing", "control"),
            ],
        )
        self.assertEqual(exposures[3]["groups"], {"company": "acme"})
        for request in self.server.to("/e"):
            self.assertEqual(batch_errors(request.body), [])


if __name__ == "__main__":
    unittest.main()
