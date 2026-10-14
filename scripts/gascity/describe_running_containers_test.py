#!/usr/bin/env python3
"""Container inventory lines never include secret values."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from describe_running_containers import env_marks, public_image, task_lines  # noqa: E402
from read_host_containers import REMOTE_READ, safe_line, ssh_command  # noqa: E402
from read_image_paths import ecr_host, inspect_command, keep_path  # noqa: E402


class DescribeTest(unittest.TestCase):
    def test_lines_keep_mounts_and_drop_secret_values(self):
        lines = task_lines(
            "ap-southeast-1",
            "wewebplus",
            {
                "taskArn": "arn:aws:ecs:ap-southeast-1:755283537543:task/wewebplus/abc123",
                "launchType": "FARGATE",
                "enableExecuteCommand": False,
                "lastStatus": "RUNNING",
                "containers": [
                    {
                        "name": "dyad",
                        "image": "755283537543.dkr.ecr.ap-southeast-1.amazonaws.com/dyad-formula-preview@sha256:abc",
                    }
                ],
            },
            {
                "volumes": [{"name": "city", "host": {"sourcePath": "/opt/gascity/city"}}],
                "containerDefinitions": [
                    {
                        "name": "dyad",
                        "entryPoint": ["gc"],
                        "command": ["supervisor", "run"],
                        "mountPoints": [
                            {
                                "containerPath": "/opt/gascity/city",
                                "sourceVolume": "city",
                            }
                        ],
                        "environment": [
                            {
                                "name": "GAS_CITY_SUPERVISOR_URL",
                                "value": "https://secret.example/city",
                            },
                            {"name": "GAS_CITY_CITY_NAME", "value": ""},
                        ],
                        "secrets": [
                            {
                                "name": "WEWEBPLUS_DATABASE_URL",
                                "valueFrom": "arn:aws:secretsmanager:secret-value",
                            }
                        ],
                    }
                ],
            },
        )
        text = "\n".join(lines)
        self.assertIn("launch=FARGATE", text)
        self.assertIn("exec=no", text)
        self.assertIn("path=/opt/gascity/city", text)
        self.assertIn("volume name=city host=/opt/gascity/city", text)
        self.assertIn("GAS_CITY_SUPERVISOR_URL=set", text)
        self.assertIn("GAS_CITY_CITY_NAME=empty", text)
        self.assertIn("secrets container=dyad WEWEBPLUS_DATABASE_URL", text)
        self.assertNotIn("secret.example", text)
        self.assertNotIn("secret-value", text)
        self.assertEqual(public_image("https://user:password@example/app"), "redacted-image")
        self.assertEqual(env_marks([{"name": "TOKEN", "value": "abc"}]), ["TOKEN=set"])

    def test_host_read_does_not_print_the_environment(self):
        command = ssh_command("/tmp/key", "ubuntu", "18.138.239.14", "/tmp/known")
        self.assertEqual(command[-1], REMOTE_READ)
        self.assertNotIn("printenv", REMOTE_READ)
        self.assertNotIn("Config.Env", REMOTE_READ)
        self.assertNotIn("set -x", REMOTE_READ)
        self.assertIn("/opt/gascity/city/formulas", REMOTE_READ)
        self.assertEqual(safe_line("postgres://user:secret@db/app"), "redacted")
        self.assertEqual(safe_line("gc supervisor run"), "gc supervisor run")

    def test_image_scan_looks_for_formula_files(self):
        self.assertTrue(keep_path("opt/gascity/city/formulas/discovery.toml"))
        self.assertFalse(keep_path("opt/gascity/weaver.env"))
        self.assertEqual(
            ecr_host(
                "755283537543.dkr.ecr.ap-southeast-1.amazonaws.com/dyad-formula-preview:latest"
            ),
            "755283537543.dkr.ecr.ap-southeast-1.amazonaws.com",
        )
        self.assertEqual(ecr_host("ghcr.io/example/app:latest"), "")
        command = inspect_command("example:latest")
        self.assertIn("--entrypoint", command)
        self.assertNotIn("printenv", command[-1])


if __name__ == "__main__":
    unittest.main()
