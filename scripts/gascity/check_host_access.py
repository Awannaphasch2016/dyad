#!/usr/bin/env python3
"""Report, from the production host, whether its Doppler tokens still work.

Runs over SSH as ``python3 -``. Prints project and config names, HTTP
statuses, and whether named secrets exist. Never prints a token, a secret
value, or a role ARN. Exit 0 when both tokens answer 200, otherwise 1.
"""

import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

DYAD_TOKEN_FILE = "/etc/doppler/dyad-preview.token"
# Phase 3 of plans/doppler-organization.md installs this file; it is optional
# until then and reported as absent, which is not a failure.
PRD_TOKEN_FILE = "/etc/doppler/dyad-prd.token"
AWS_TOKEN_FILE = "/etc/doppler/aws-dev.token"
ROLE_SECRET = "AWS_PREVIEW_FORMULA_ROLE_ARN"
SSH_KEY_SECRET = "EC2_SSH_KEY"


def read_root_file(path):
    if os.geteuid() == 0:
        try:
            with open(path, encoding="utf-8") as handle:
                return handle.read().strip()
        except OSError:
            return ""
    proc = subprocess.run(
        ["sudo", "-n", "cat", path],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        return ""
    return proc.stdout.strip()


def doppler_get(token, url):
    request = urllib.request.Request(
        url, headers={"Authorization": f"Bearer {token}", "Accept": "application/json"}
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        return error.code, {}
    except (urllib.error.URLError, TimeoutError, ValueError):
        return 0, {}


def describe(label, path, optional=False):
    token = read_root_file(path)
    if not token:
        if optional and not os.path.exists(path):
            print(f"{label}_token=absent file={path}")
        else:
            print(f"{label}_token=missing file={path}")
        return False, None
    status, body = doppler_get(token, "https://api.doppler.com/v3/configs/config")
    config = body.get("config") or {}
    project = config.get("project") or "unknown"
    name = config.get("name") or "unknown"
    print(f"{label}_token=http-{status} project={project} config={name}")
    if status != 200:
        return False, None
    return True, token


def secret_names(token):
    status, body = doppler_get(
        token, "https://api.doppler.com/v3/configs/config/secrets/names"
    )
    if status != 200:
        return status, []
    return status, sorted(body.get("names") or [])


def main():
    print("host-access-check start", flush=True)
    print(f"host={os.uname().nodename} user={os.environ.get('USER', 'unknown')}")
    ok_dyad, dyad_token = describe("dyad", DYAD_TOKEN_FILE)
    describe("dyad_prd", PRD_TOKEN_FILE, optional=True)
    ok_aws, _aws_token = describe("aws", AWS_TOKEN_FILE)
    if ok_dyad:
        status, names = secret_names(dyad_token)
        print(f"dyad_secret_names=http-{status} count={len(names)}")
        for wanted in (ROLE_SECRET, SSH_KEY_SECRET):
            state = "present" if wanted in names else "absent"
            print(f"{wanted}={state}")
    print(f"host_doppler={'ok' if ok_dyad and ok_aws else 'broken'}")
    return 0 if ok_dyad and ok_aws else 1


if __name__ == "__main__":
    sys.exit(main())
