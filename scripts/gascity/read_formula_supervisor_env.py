#!/usr/bin/env python3
"""Read supervisor candidate settings on the production host. Does not print values."""

import json
import os
import stat
import subprocess
import sys
import tempfile

from formula_supervisor_select import (
    CITY_NAME,
    CITY_NAMES,
    GRANT_NAMES,
    NAMES,
    SUPERVISOR_URL,
    URL_NAMES,
    WRITE_GRANT,
    tunnel_url_from_config,
    usable,
    usable_supervisor_url,
)

KEEP = set(URL_NAMES + CITY_NAMES + GRANT_NAMES)
ENV_PATHS = (
    "opt/gascity/weaver.env",
    "opt/gascity/bridge.env",
    "opt/gascity/city.env",
)
CONFIG_PATHS = (
    "etc/cloudflared/config.yml",
    "etc/cloudflared/config.yaml",
    "home/ubuntu/.cloudflared/config.yml",
)


def parse_env_text(text):
    found = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].strip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        if key in KEEP:
            found[key] = value
    return found


def read_text(path):
    try:
        with open(path, encoding="utf-8") as handle:
            return handle.read()
    except OSError:
        return ""


def collect(root):
    found = {}
    for relative in ENV_PATHS:
        found.update(parse_env_text(read_text(os.path.join(root, relative))))
    if not usable_supervisor_url(found.get(SUPERVISOR_URL)):
        for relative in CONFIG_PATHS:
            url = tunnel_url_from_config(read_text(os.path.join(root, relative)))
            if url:
                found[SUPERVISOR_URL] = url
                break
    return found


def listen_class():
    try:
        proc = subprocess.run(
            ["ss", "-ltn"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return ""
    saw = False
    for line in proc.stdout.splitlines():
        if ":8372" not in line:
            continue
        saw = True
        if "127.0.0.1:8372" in line or "[::1]:8372" in line:
            return "loopback"
    if saw:
        return "reachable"
    return "closed"


def write_secret_file(found):
    payload = {key: value for key, value in found.items() if key in KEEP and usable_kept(key, value)}
    descriptor, path = tempfile.mkstemp(prefix="formula-supervisor-", dir="/tmp")
    try:
        os.write(descriptor, json.dumps(payload).encode("utf-8"))
    finally:
        os.close(descriptor)
    os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)
    if not path.startswith("/tmp/formula-supervisor-"):
        os.remove(path)
        raise SystemExit("supervisor file path was not created")
    return path


def usable_kept(key, value):
    if key in URL_NAMES:
        return usable(SUPERVISOR_URL, value)
    if key in CITY_NAMES:
        return usable("GAS_CITY_CITY_NAME", value)
    if key in GRANT_NAMES:
        return usable("GAS_CITY_CITY_WRITE_GRANT", value)
    return False


def main():
    root = sys.argv[1] if len(sys.argv) == 2 else "/"
    found = collect(root)
    path = write_secret_file(found)
    for name in (SUPERVISOR_URL, CITY_NAME, WRITE_GRANT):
        state = "present" if any(usable(name, found.get(alias)) for alias in NAMES[name]) else "absent"
        print(f"{name}: {state}")
    listen = listen_class()
    if listen:
        print(f"listen={listen}")
    print(f"secret_file={path}", flush=True)
    return 0


if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    sys.exit(main())
