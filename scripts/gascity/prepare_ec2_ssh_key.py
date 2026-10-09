#!/usr/bin/env python3
"""Write the production SSH key for the formula role job. Does not print the key.

The GitHub Actions secret is used when it is set. Otherwise the key is read
from the Doppler config that DOPPLER_TOKEN can download. The value stays in
this process and in the mode-600 output file.
"""

import json
import os
import stat
import sys
import urllib.error
import urllib.request


def write_key(path, value):
    if "\n" not in value and "\\n" in value:
        value = value.replace("\\n", "\n")
    if not value.endswith("\n"):
        value += "\n"
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(value)
    os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)


def key_from_doppler():
    token = os.environ.get("DOPPLER_TOKEN", "").strip()
    if not token:
        print("doppler token absent")
        return ""
    request = urllib.request.Request(
        "https://api.doppler.com/v3/configs/config/secrets/download?format=json",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = json.loads(response.read().decode("utf-8"))
            print(f"doppler download http {response.status}")
    except urllib.error.HTTPError as error:
        error.read()
        print(f"doppler download http {error.code}")
        return ""
    if not isinstance(body, dict):
        print("doppler EC2_SSH_KEY absent")
        return ""
    value = body.get("EC2_SSH_KEY") or ""
    print("doppler EC2_SSH_KEY " + ("present" if str(value).strip() else "absent"))
    return str(value)


def main():
    if len(sys.argv) != 2:
        sys.stderr.write("usage: prepare_ec2_ssh_key.py OUTPUT\n")
        return 2
    value = os.environ.get("EC2_SSH_KEY", "")
    source = "github"
    if not value.strip():
        value = key_from_doppler()
        source = "doppler"
    if not value.strip():
        sys.stderr.write(
            "EC2_SSH_KEY is empty in the GitHub secret and in the Doppler config this token can read.\n"
        )
        return 1
    write_key(sys.argv[1], value)
    print(f"ssh key source={source}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
