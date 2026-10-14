#!/usr/bin/env python3
"""Copy GasCity supervisor settings into Doppler dyad/preview. Does not print values."""

import json
import os
import sys
import urllib.error
import urllib.request

from formula_supervisor_select import (
    CITY_NAME,
    SUPERVISOR_URL,
    WRITE_GRANT,
    choose_supervisor,
    missing_required,
    secret_file_from_log,
    updates_for_preview,
    usable,
)

PROJECT = "dyad"
CONFIG = "preview"
STATUS_NAMES = (SUPERVISOR_URL, CITY_NAME, WRITE_GRANT)


def download(token, project, config):
    query = f"format=json&project={project}&config={config}"
    request = urllib.request.Request(
        "https://api.doppler.com/v3/configs/config/secrets/download?" + query,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = json.loads(response.read().decode("utf-8"))
            print(f"doppler download http {response.status} project={project} config={config}")
            return response.status, body if isinstance(body, dict) else {}
    except urllib.error.HTTPError as error:
        error.read()
        print(f"doppler download http {error.code} project={project} config={config}")
        return error.code, {}


def post_secrets(token, secrets):
    payload = {"project": PROJECT, "config": CONFIG, "secrets": secrets}
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


def print_states(preview, chosen, updates, wrote):
    for name in STATUS_NAMES:
        if usable(name, preview.get(name)):
            state = "present"
        elif name in updates and wrote:
            state = "copied"
        else:
            state = "absent"
        print(f"{name}: {state}")


def apply_settings(token, host=None):
    status, preview = download(token, PROJECT, CONFIG)
    if status != 200:
        return 1
    prd_status, prd = download(token, PROJECT, "prd")
    if prd_status != 200:
        prd = {}
    chosen = choose_supervisor(preview, prd, host)
    updates = updates_for_preview(preview, chosen)
    wrote = False
    if updates:
        http = post_secrets(token, updates)
        print(f"doppler secrets set http {http} project={PROJECT} config={CONFIG}")
        if http not in (200, 201):
            print_states(preview, chosen, updates, False)
            return 1
        wrote = True
    print_states(preview, chosen, updates, wrote)
    if missing_required(chosen):
        print("supervisor settings are still absent")
        return 3
    return 0


def read_host_file(path):
    with open(path, encoding="utf-8") as handle:
        body = json.load(handle)
    os.remove(path)
    if not isinstance(body, dict):
        raise SystemExit("supervisor file was not a JSON object")
    host = {}
    for key, value in body.items():
        if isinstance(key, str) and isinstance(value, str):
            host[key] = value
    return host


def main():
    if len(sys.argv) == 3 and sys.argv[1] == "--secret-file-from-log":
        found = secret_file_from_log(open(sys.argv[2], encoding="utf-8").read())
        if not found:
            sys.stderr.write("supervisor file was not created\n")
            return 1
        sys.stdout.write(found)
        return 0
    token = os.environ.get("DOPPLER_ADMIN_TOKEN", "").strip()
    if not token:
        sys.stderr.write("doppler admin token absent\n")
        return 1
    host = None
    if len(sys.argv) == 2 and sys.argv[1] == "--from-doppler":
        return apply_settings(token)
    if len(sys.argv) == 3 and sys.argv[1] == "--host-env":
        host = read_host_file(sys.argv[2])
        return apply_settings(token, host)
    sys.stderr.write(
        "usage: store_formula_supervisor.py --from-doppler | --host-env FILE | --secret-file-from-log FILE\n"
    )
    return 2


if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    sys.exit(main())
