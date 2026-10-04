#!/usr/bin/env python3
"""Provision tests for preview_poller.py. No Dyad process."""

import os
import unittest

import preview_poller


class Response:
    def __init__(self, body):
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return self.body


class PreviewPollerTest(unittest.TestCase):
    def setUp(self):
        self._env = {
            key: os.environ.get(key)
            for key in ("WEAVER_BASE_URL", "GAS_CITY_HOST_BRIDGE_TOKEN")
        }
        os.environ["WEAVER_BASE_URL"] = "http://dyad:32100"
        os.environ["GAS_CITY_HOST_BRIDGE_TOKEN"] = "machine-token"

    def tearDown(self):
        for key, value in self._env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def test_provision_posts_without_origin_and_returns_one_app_id(self):
        seen = []

        def opener(request):
            seen.append(request)
            return Response(b'{"appId": 7}')

        app_id = preview_poller.provision_app(
            opener=opener, sleep=lambda _seconds: None, attempts=1
        )
        self.assertEqual(app_id, 7)
        self.assertEqual(len(seen), 1)
        self.assertEqual(
            seen[0].full_url, "http://dyad:32100/v1/preview-factory-app"
        )
        self.assertIsNone(seen[0].get_header("Origin"))
        self.assertEqual(seen[0].get_header("Authorization"), "Bearer machine-token")

    def test_provision_retries_until_the_app_id_is_present(self):
        bodies = [b"{}", b'{"appId": 4}']

        def opener(_request):
            return Response(bodies.pop(0))

        app_id = preview_poller.provision_app(
            opener=opener, sleep=lambda _seconds: None, attempts=2
        )
        self.assertEqual(app_id, 4)
        self.assertEqual(bodies, [])


if __name__ == "__main__":
    unittest.main()
