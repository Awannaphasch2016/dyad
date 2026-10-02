#!/usr/bin/env python3
"""Post one HITL question to the Dyad factory bridge.

The factory caller used for the two-user test talks to
http://127.0.0.1:32100/v1/apps/<id>/phases/<phase>/questions.
A repeated idempotency key returns the existing question.
"""

import json
import os
import sys
import urllib.error
import urllib.request

BRIDGE_URL = os.environ.get("BRIDGE_URL", "http://127.0.0.1:32100").rstrip("/")
TOKEN = os.environ.get("GAS_CITY_HOST_BRIDGE_TOKEN", "")


def main() -> int:
    if len(sys.argv) != 2:
        sys.stderr.write(
            "usage: post_hitl_question.py <question.json>\n"
        )
        return 2
    if not TOKEN:
        sys.stderr.write("GAS_CITY_HOST_BRIDGE_TOKEN is required\n")
        return 2
    payload = json.load(open(sys.argv[1], encoding="utf-8"))
    app_id = payload.pop("appId")
    phase = payload.pop("phase")
    request = urllib.request.Request(
        f"{BRIDGE_URL}/v1/apps/{app_id}/phases/{phase}/questions",
        data=json.dumps(payload).encode(),
        method="POST",
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
            "User-Agent": "wewebplus-hitl",
        },
    )
    try:
        with urllib.request.urlopen(request) as response:
            sys.stdout.write(response.read().decode())
            sys.stdout.write("\n")
            return 0
    except urllib.error.HTTPError as error:
        sys.stderr.write(error.read().decode())
        return error.code or 1


if __name__ == "__main__":
    raise SystemExit(main())
