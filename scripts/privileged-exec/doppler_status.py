#!/usr/bin/env python3
"""Print Doppler status for one privileged-exec job.

Reads DOPPLER_TOKEN from the environment. Prints HTTP statuses and whether
an allowlisted name exists. Never prints a token or a secret value.
"""

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

PROBES = (("dyad", "preview"), ("aws", "dev"))
NAMES = ("CURSOR_API_KEY", "EC2_SSH_KEY")


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


def config_line(project, config, status, body):
    found = body.get("config") if isinstance(body, dict) else None
    found = found if isinstance(found, dict) else {}
    got_project = found.get("project") or "unknown"
    got_config = found.get("name") or "unknown"
    key = f"{project}_{config}"
    return f"{key}=http-{status} project={got_project} config={got_config}"


def name_lines(status, names):
    known = set(names)
    lines = [f"secret_names=http-{status} count={len(names)}"]
    for wanted in NAMES:
        state = "present" if wanted in known else "absent"
        lines.append(f"{wanted}={state}")
    return lines


def main():
    token = os.environ.get("DOPPLER_TOKEN", "").strip()
    if not token:
        print("doppler_token=absent")
        return 1
    preview_ok = False
    for project, config in PROBES:
        query = urllib.parse.urlencode({"project": project, "config": config})
        status, body = doppler_get(
            token, f"https://api.doppler.com/v3/configs/config?{query}"
        )
        print(config_line(project, config, status, body))
        if project == "dyad" and config == "preview" and status == 200:
            preview_ok = True
            names_query = urllib.parse.urlencode(
                {"project": project, "config": config}
            )
            name_status, name_body = doppler_get(
                token,
                "https://api.doppler.com/v3/configs/config/secrets/names?"
                + names_query,
            )
            names = []
            if name_status == 200 and isinstance(name_body, dict):
                raw = name_body.get("names") or []
                names = sorted(name for name in raw if isinstance(name, str))
            for line in name_lines(name_status, names):
                print(line)
    return 0 if preview_ok else 1


if __name__ == "__main__":
    sys.exit(main())
