#!/usr/bin/env python3
"""Provision one preview factory app, then poll released answers.

The listener stores the question. This process POSTs the factory run only
after resolve_hitl_answer.py releases the gate. The request has no Origin
header.
"""

import json
import os
import subprocess
import sys
import time
import urllib.request


def provision_once(opener, base, token):
    request = urllib.request.Request(
        f"{base.rstrip('/')}/v1/preview-factory-app",
        data=b"{}",
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    with opener(request) as response:
        parsed = json.loads(response.read().decode() or "{}")
    app_id = parsed.get("appId")
    if isinstance(app_id, bool):
        return None
    if isinstance(app_id, int) and app_id > 0:
        return app_id
    if isinstance(app_id, str) and app_id.isdigit() and int(app_id) > 0:
        return int(app_id)
    return None


def provision_app(opener=urllib.request.urlopen, sleep=time.sleep, attempts=None):
    base = os.environ.get("WEAVER_BASE_URL", "").strip()
    token = os.environ.get("GAS_CITY_HOST_BRIDGE_TOKEN", "").strip()
    if not base or not token:
        raise SystemExit("WEAVER_BASE_URL and GAS_CITY_HOST_BRIDGE_TOKEN are required")
    remaining = attempts
    while remaining is None or remaining > 0:
        if remaining is not None:
            remaining -= 1
        try:
            app_id = provision_once(opener, base, token)
        except Exception:
            app_id = None
        if app_id:
            return app_id
        sleep(2)
    raise SystemExit("Factory app was not provisioned")


def main():
    app_id = provision_app()
    os.environ["FACTORY_APP_ID"] = str(app_id)
    script = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "resolve_hitl_answer.py"
    )
    while True:
        subprocess.run([sys.executable, script], check=False)
        time.sleep(5)


if __name__ == "__main__":
    main()
