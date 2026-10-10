#!/usr/bin/env python3
"""Report whether a forwarded Doppler token can read dyad/preview.

Runs on the production host as ``python3 -``. Prints project, config, and
HTTP status. Never prints a token or a secret value. Exit 0 when dyad/preview
answers 200.
"""

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


def doppler_get(token, url):
    request = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        return error.code, {}
    except (urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError):
        return 0, {}


def probe(token, project, config):
    query = urllib.parse.urlencode({"project": project, "config": config})
    status, body = doppler_get(
        token, f"https://api.doppler.com/v3/configs/config?{query}"
    )
    found = body.get("config") if isinstance(body, dict) else None
    found = found if isinstance(found, dict) else {}
    return status, found.get("project") or "unknown", found.get("name") or "unknown"


def main():
    token = os.environ.get("DOPPLER_TOKEN", "").strip()
    if not token:
        print("forwarded_token=absent")
        print("aws_token_via_forwarded=absent")
        print("host_doppler=broken")
        return 1
    status, project, config = probe(token, "dyad", "preview")
    print(f"forwarded_token=http-{status} project={project} config={config}")
    aws_status, aws_project, aws_config = probe(token, "aws", "dev")
    print(
        f"aws_token_via_forwarded=http-{aws_status} project={aws_project} config={aws_config}"
    )
    ok = status == 200
    print(f"host_doppler={'ok' if ok else 'broken'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
