"""Print only the project identity inside a Google credential JSON.

Reads the credential on stdin. Writes lines the workflow can log:
shape, project_id, project_number. Never prints secrets, client ids,
refresh tokens, or private keys.
"""

import json
import re
import sys

SECRET_KEYS = {
    "client_secret",
    "private_key",
    "private_key_id",
    "refresh_token",
    "access_token",
    "id_token",
    "token",
}


def main():
    raw = sys.stdin.read()
    if not raw.strip():
        print("shape=empty")
        return
    try:
        info = json.loads(raw)
    except json.JSONDecodeError:
        print("shape=not-json")
        print(f"length={len(raw)}")
        return
    if not isinstance(info, dict):
        print(f"shape={type(info).__name__}")
        return

    project_id = None
    project_number = None
    shape = "json"

    def take_id(value):
        nonlocal project_id
        if isinstance(value, str) and value and project_id is None:
            project_id = value

    def take_client(value):
        nonlocal project_number
        if not isinstance(value, str):
            return
        match = re.match(r"(\d+)-", value)
        if match and project_number is None:
            project_number = match.group(1)

    if info.get("type") == "service_account":
        shape = "service_account"
        email = info.get("client_email") or ""
        if email.endswith(".iam.gserviceaccount.com"):
            take_id(email.split("@", 1)[1].removesuffix(".iam.gserviceaccount.com"))
        take_id(info.get("project_id"))
    elif info.get("type") == "authorized_user" or info.get("refresh_token"):
        shape = "authorized_user"
        take_client(info.get("client_id"))
        take_id(info.get("quota_project_id"))
    elif "web" in info or "installed" in info:
        block_name = "web" if "web" in info else "installed"
        shape = f"oauth_client_{block_name}"
        block = info.get(block_name) or {}
        if isinstance(block, dict):
            take_id(block.get("project_id"))
            take_client(block.get("client_id"))
    else:
        take_id(info.get("project_id") or info.get("quota_project_id"))
        take_client(info.get("client_id"))
        print("top_level_keys=" + ",".join(sorted(k for k in info if k not in SECRET_KEYS)))

    print(f"shape={shape}")
    if project_id:
        print(f"project_id={project_id}")
    if project_number:
        print(f"project_number={project_number}")


if __name__ == "__main__":
    main()
