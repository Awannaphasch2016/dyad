#!/usr/bin/env python3
"""List formula-related paths inside container images. Does not print secrets."""

import subprocess
import sys

FORMULA_FILES = {"discovery.toml", "implementation.toml", "delivery.toml", "gc"}
INSPECT = (
    "find /opt/gascity /home/weaver /usr/local/bin /usr/bin /city /app "
    "\\( -name discovery.toml -o -name implementation.toml "
    "-o -name delivery.toml -o -name gc \\) 2>/dev/null | head -80; "
    "ls -d /opt/gascity /opt/gascity/city /opt/gascity/city/formulas 2>/dev/null"
)


def keep_path(name):
    base = name.rsplit("/", 1)[-1]
    lowered = name.lower()
    if base in FORMULA_FILES:
        return True
    if "/formulas/" in lowered or lowered.endswith("/formulas"):
        return True
    return "gascity" in lowered and base in {"city", "gc"}


def ecr_host(image):
    host = image.split("/", 1)[0]
    if ".dkr.ecr." not in host or ".amazonaws.com" not in host:
        return ""
    return host


def inspect_command(image):
    return ["docker", "run", "--rm", "--entrypoint", "sh", image, "-c", INSPECT]


def login_ecr(image, run):
    host = ecr_host(image)
    if not host:
        return True
    region = host.split(".dkr.ecr.", 1)[1].split(".", 1)[0]
    password = run(
        ["aws", "ecr", "get-login-password", "--region", region],
        input_text=None,
    )
    if password.returncode != 0:
        print("ecr login failed")
        return False
    login = run(
        ["docker", "login", "--username", "AWS", "--password-stdin", host],
        input_text=password.stdout,
    )
    print("ecr login ok" if login.returncode == 0 else "ecr login failed")
    return login.returncode == 0


def scan_image(image, run):
    print(f"image={image}")
    if not login_ecr(image, run):
        return
    pulled = run(["docker", "pull", image], input_text=None)
    if pulled.returncode != 0:
        print("image pull failed")
        return
    inspected = run(inspect_command(image), input_text=None)
    lines = [line.strip() for line in (inspected.stdout or "").splitlines() if line.strip()]
    if inspected.returncode != 0 and not lines:
        print("image inspect failed")
        return
    printed = [line for line in lines if keep_path(line) or line.startswith("/opt/gascity")]
    if not printed:
        print("formula paths absent")
        return
    for line in printed[:80]:
        print(f"path={line}")


def main():
    if len(sys.argv) != 2:
        sys.stderr.write("usage: read_image_paths.py IMAGE_LIST\n")
        return 2
    with open(sys.argv[1], encoding="utf-8") as handle:
        images = [line.strip() for line in handle if line.strip()]

    def run(command, input_text):
        return subprocess.run(
            command,
            input=input_text,
            capture_output=True,
            text=True,
            timeout=600,
            check=False,
        )

    for image in images:
        try:
            scan_image(image, run)
        except subprocess.TimeoutExpired:
            print("image scan timeout")
    return 0


if __name__ == "__main__":
    sys.exit(main())
