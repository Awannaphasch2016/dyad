#!/usr/bin/env python3
"""Write the compose env file from a Doppler JSON download.

Reads a flat JSON object on stdin. Writes a shell env file to the path in
argv[1]. Only the names compose interpolates are kept, plus the fixed Gas
City bridge settings. Other Doppler names, including EC2_SSH_KEY, are dropped.
"""

import json
import shlex
import sys

ALLOW = (
    "NOVNC_PASSWORD",
    "GAS_CITY_HOST_BRIDGE_TOKEN",
    "CLERK_PUBLISHABLE_KEY",
    "CLERK_SECRET_KEY",
    "WEWEBPLUS_DATABASE_URL",
    "WEWEBPLUS_SECRETS_KEY",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_REGION",
)

FIXED = (
    ("DYAD_BROWSER_BRIDGE", "1"),
    ("DYAD_BROWSER_BRIDGE_PORT", "8373"),
    ("WEAVER_PROJECTS_DIR", "/opt/gascity/projects"),
    ("NOVNC_PORT", "6080"),
    ("NOVNC_GEOMETRY", "1600x900"),
    ("GAS_CITY_HOST_BRIDGE_ENABLED", "true"),
    ("GAS_CITY_HOST_BRIDGE_PORT", "32100"),
)


def main() -> int:
    if len(sys.argv) != 2:
        sys.stderr.write("usage: write_rollout_env.py OUTPUT\n")
        return 2
    data = json.load(sys.stdin)
    if not isinstance(data, dict):
        sys.stderr.write("Doppler JSON must be an object of string values\n")
        return 2
    missing = [
        name
        for name in ALLOW
        if not isinstance(data.get(name), str) or data.get(name) == ""
    ]
    if missing:
        sys.stderr.write("Doppler preview is missing: " + ", ".join(missing) + "\n")
        return 2
    lines = [f"{name}={shlex.quote(data[name])}" for name in ALLOW]
    lines.extend(f"{name}={shlex.quote(value)}" for name, value in FIXED)
    with open(sys.argv[1], "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
