#!/usr/bin/env python3
"""Report, from the production host, whether Doppler answers.

Runs over SSH as ``python3 -``. A token forwarded in DOPPLER_TOKEN is probed
against dyad/preview and aws/dev. The root-owned token files are reported
too. Prints project and config names, HTTP statuses, and whether named
secrets exist. Never prints a token, a secret value, or a role ARN. Exit 0
when the forwarded token can read both configs, or when both files answer
200. Otherwise 1.
"""

import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
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


def host_is_ok(files_ok, forwarded_ok):
    return bool(files_ok or forwarded_ok)


def probe(token, project, config):
    query = urllib.parse.urlencode({"project": project, "config": config})
    status, body = doppler_get(token, f"https://api.doppler.com/v3/configs/config?{query}")
    found = body.get("config") or {}
    return status, found.get("project") or "unknown", found.get("name") or "unknown"


def secret_names(token, project="", config=""):
    url = "https://api.doppler.com/v3/configs/config/secrets/names"
    if project and config:
        url += "?" + urllib.parse.urlencode({"project": project, "config": config})
    status, body = doppler_get(token, url)
    if status != 200:
        return status, []
    return status, sorted(body.get("names") or [])


def report_names(token, project="", config=""):
    status, names = secret_names(token, project, config)
    print(f"dyad_secret_names=http-{status} count={len(names)}")
    for wanted in (ROLE_SECRET, SSH_KEY_SECRET):
        state = "present" if wanted in names else "absent"
        print(f"{wanted}={state}")


def main():
    print("host-access-check start", flush=True)
    print(f"host={os.uname().nodename} user={os.environ.get('USER', 'unknown')}")
    ok_dyad, dyad_token = describe("dyad", DYAD_TOKEN_FILE)
    describe("dyad_prd", PRD_TOKEN_FILE, optional=True)
    ok_aws, _aws_token = describe("aws", AWS_TOKEN_FILE)
    forwarded = os.environ.get("DOPPLER_TOKEN", "").strip()
    ok_forwarded = False
    if forwarded:
        status, project, config = probe(forwarded, "dyad", "preview")
        print(f"forwarded_token=http-{status} project={project} config={config}")
        aws_status, aws_project, aws_config = probe(forwarded, "aws", "dev")
        print(
            f"aws_token_via_forwarded=http-{aws_status} project={aws_project} config={aws_config}"
        )
        ok_forwarded = status == 200 and aws_status == 200
        if not ok_dyad and status == 200:
            report_names(forwarded, "dyad", "preview")
    else:
        print("forwarded_token=absent")
        print("aws_token_via_forwarded=absent")
    if ok_dyad:
        report_names(dyad_token)
    ok = host_is_ok(ok_dyad and ok_aws, ok_forwarded)
    print(f"host_doppler={'ok' if ok else 'broken'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
