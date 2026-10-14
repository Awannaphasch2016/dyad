#!/usr/bin/env python3
"""Store AWS_PREVIEW_FORMULA_ROLE_ARN in Doppler dyad/preview. Does not print the value."""

import json
import os
import re
import sys
import urllib.error
import urllib.request

SECRET_NAME = "AWS_PREVIEW_FORMULA_ROLE_ARN"
ROLE_FILE = re.compile(r"/tmp/formula-role-[A-Za-z0-9._-]+")
ROLE_ARN = re.compile(r"arn:aws:iam::[0-9]{12}:role/[A-Za-z0-9+=,.@_-]+")


def role_file_from_log(text):
    found = ""
    for line in text.splitlines():
        if line.startswith("role_file="):
            found = line.split("=", 1)[1].strip()
    if not ROLE_FILE.fullmatch(found):
        return ""
    return found


def store(token, role_arn):
    payload = {
        "project": "dyad",
        "config": "preview",
        "secrets": {SECRET_NAME: role_arn},
    }
    request = urllib.request.Request(
        "https://api.doppler.com/v3/configs/config/secrets",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            response.read()
            return response.status
    except urllib.error.HTTPError as error:
        error.read()
        return error.code


def main():
    if len(sys.argv) == 3 and sys.argv[1] == "--role-file-from-log":
        found = role_file_from_log(open(sys.argv[2], encoding="utf-8").read())
        if not found:
            sys.stderr.write("role file was not created\n")
            return 1
        sys.stdout.write(found)
        return 0
    if len(sys.argv) != 2:
        sys.stderr.write("usage: store_formula_role_arn.py ROLE_FILE\n")
        return 2
    token = os.environ.get("DOPPLER_ADMIN_TOKEN", "").strip()
    if not token:
        sys.stderr.write("doppler admin token absent\n")
        return 1
    with open(sys.argv[1], encoding="utf-8") as handle:
        role_arn = handle.read().strip()
    os.remove(sys.argv[1])
    if not ROLE_ARN.fullmatch(role_arn):
        sys.stderr.write("role file did not contain a role address\n")
        return 1
    status = store(token, role_arn)
    print(f"doppler secrets set {SECRET_NAME} http {status} project=dyad config=preview")
    if status not in (200, 201):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
