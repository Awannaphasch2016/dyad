#!/usr/bin/env python3
"""Selector tests. Fixture addresses only; nothing here is a live secret."""

import json
import os
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from formula_supervisor_select import (  # noqa: E402
    SUPERVISOR_URL,
    choose_supervisor,
    missing_required,
    ordered_configs,
    secret_file_from_log,
    service_targets_supervisor,
    setting_state,
    tunnel_url_from_config,
    updates_for_preview,
    usable_city_name,
    usable_supervisor_url,
    usable_write_grant,
)


class SelectTest(unittest.TestCase):
    def test_url_rejects_loopback_and_private(self):
        self.assertTrue(usable_supervisor_url("https://city.example/v0"))
        self.assertTrue(usable_supervisor_url("http://13.251.216.187:8372"))
        self.assertFalse(usable_supervisor_url("http://127.0.0.1:8372"))
        self.assertFalse(usable_supervisor_url("http://localhost:8372"))
        self.assertFalse(usable_supervisor_url("http://[::1]:8372"))
        self.assertFalse(usable_supervisor_url("http://10.0.0.4:8372"))
        self.assertFalse(usable_supervisor_url("http://172.31.14.171:8372"))
        self.assertFalse(usable_supervisor_url("http://192.168.1.8:8372"))
        self.assertFalse(usable_supervisor_url("http://user:secret@city.example"))
        self.assertFalse(usable_supervisor_url("ftp://city.example"))
        self.assertFalse(usable_supervisor_url(""))

    def test_city_and_grant(self):
        self.assertTrue(usable_city_name("wewebplus"))
        self.assertFalse(usable_city_name("../city"))
        self.assertFalse(usable_city_name(""))
        self.assertTrue(usable_write_grant("grant-token"))
        self.assertFalse(usable_write_grant(""))
        self.assertFalse(usable_write_grant("has space"))

    def test_preview_canonical_wins_over_prd_alias(self):
        chosen = choose_supervisor(
            {"GAS_CITY_SUPERVISOR_URL": "https://preview.example"},
            {"GC_SUPERVISOR_URL": "https://prd.example", "GAS_CITY_CITY_NAME": "wewebplus"},
        )
        self.assertEqual(chosen["GAS_CITY_SUPERVISOR_URL"], "https://preview.example")
        self.assertEqual(chosen["GAS_CITY_CITY_NAME"], "wewebplus")
        self.assertEqual(chosen["GAS_CITY_CITY_WRITE_GRANT"], "")

    def test_loopback_preview_falls_through_to_alias(self):
        chosen = choose_supervisor(
            {
                "GAS_CITY_SUPERVISOR_URL": "http://127.0.0.1:8372",
                "GC_SUPERVISOR_URL": "https://city.example",
                "GC_CITY": "wewebplus",
            }
        )
        self.assertEqual(chosen["GAS_CITY_SUPERVISOR_URL"], "https://city.example")
        self.assertEqual(chosen["GAS_CITY_CITY_NAME"], "wewebplus")
        updates = updates_for_preview(
            {"GAS_CITY_SUPERVISOR_URL": "http://127.0.0.1:8372"},
            chosen,
        )
        self.assertEqual(
            updates,
            {
                "GAS_CITY_SUPERVISOR_URL": "https://city.example",
                "GAS_CITY_CITY_NAME": "wewebplus",
            },
        )
        self.assertEqual(missing_required(chosen), [])

    def test_other_configs_do_not_use_a_generic_city_name(self):
        chosen = choose_supervisor(
            {},
            {},
            None,
            [{"GAS_CITY_SUPERVISOR_URL": "https://dev.example", "CITY_NAME": "not-this", "GC_CITY": "wewebplus"}],
        )
        self.assertEqual(chosen["GAS_CITY_SUPERVISOR_URL"], "https://dev.example")
        self.assertEqual(chosen["GAS_CITY_CITY_NAME"], "wewebplus")
        self.assertEqual(ordered_configs(["stg", "preview", "dev", "prd"]), ["preview", "prd", "dev", "stg"])
        self.assertEqual(
            setting_state(SUPERVISOR_URL, {"GAS_CITY_SUPERVISOR_URL": "http://127.0.0.1:8372"}, {}, False),
            "rejected",
        )

    def test_host_is_last_and_grant_is_optional(self):
        chosen = choose_supervisor(
            {},
            {},
            {
                "GAS_CITY_URL": "https://host.example",
                "CITY_NAME": "city.one",
                "X_GC_CITY_WRITE": "grant-token",
            },
        )
        self.assertEqual(chosen["GAS_CITY_SUPERVISOR_URL"], "https://host.example")
        self.assertEqual(chosen["GAS_CITY_CITY_NAME"], "city.one")
        self.assertEqual(chosen["GAS_CITY_CITY_WRITE_GRANT"], "grant-token")
        self.assertEqual(missing_required({"GAS_CITY_SUPERVISOR_URL": "", "GAS_CITY_CITY_NAME": "wewebplus"}), ["GAS_CITY_SUPERVISOR_URL"])

    def test_secret_file_path(self):
        self.assertEqual(
            secret_file_from_log("secret_file=/tmp/formula-supervisor-abc123\n"),
            "/tmp/formula-supervisor-abc123",
        )
        self.assertEqual(secret_file_from_log("secret_file=/etc/passwd"), "")

    def test_tunnel_config(self):
        text = "\n".join(
            [
                "ingress:",
                "  - hostname: gc.example.com",
                "    service: http://127.0.0.1:8372",
                "  - hostname: other.example.com",
                "    service: http://127.0.0.1:8373",
            ]
        )
        self.assertEqual(tunnel_url_from_config(text), "https://gc.example.com")
        self.assertTrue(service_targets_supervisor("http://localhost:8372"))
        self.assertFalse(service_targets_supervisor("http://127.0.0.1:8373"))


class HostReadTest(unittest.TestCase):
    def test_reader_keeps_reachable_values_only(self):
        with tempfile.TemporaryDirectory() as root:
            env_dir = os.path.join(root, "opt", "gascity")
            os.makedirs(env_dir)
            with open(os.path.join(env_dir, "weaver.env"), "w", encoding="utf-8") as handle:
                handle.write(
                    "\n".join(
                        [
                            "GAS_CITY_SUPERVISOR_URL=http://127.0.0.1:8372",
                            "GC_SUPERVISOR_URL=https://city.example",
                            "GAS_CITY_CITY_NAME=wewebplus",
                            "WEWEBPLUS_DATABASE_URL=postgres://user:secret@db.example/wewebplus",
                            "GAS_CITY_CITY_WRITE_GRANT=grant-token",
                        ]
                    )
                )
            proc = subprocess.run(
                [sys.executable, os.path.join(os.path.dirname(__file__), "read_formula_supervisor_env.py"), root],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertIn("GAS_CITY_SUPERVISOR_URL: present", proc.stdout)
            self.assertIn("GAS_CITY_CITY_NAME: present", proc.stdout)
            self.assertIn("GAS_CITY_CITY_WRITE_GRANT: present", proc.stdout)
            self.assertNotIn("127.0.0.1", proc.stdout)
            self.assertNotIn("city.example", proc.stdout)
            self.assertNotIn("grant-token", proc.stdout)
            self.assertNotIn("postgres", proc.stdout)
            secret_line = next(line for line in proc.stdout.splitlines() if line.startswith("secret_file="))
            secret_path = secret_line.split("=", 1)[1]
            with open(secret_path, encoding="utf-8") as handle:
                payload = json.load(handle)
            os.remove(secret_path)
            self.assertEqual(payload["GC_SUPERVISOR_URL"], "https://city.example")
            self.assertNotIn("GAS_CITY_SUPERVISOR_URL", payload)
            self.assertNotIn("WEWEBPLUS_DATABASE_URL", payload)
            self.assertEqual(payload["GAS_CITY_CITY_NAME"], "wewebplus")


if __name__ == "__main__":
    unittest.main()
