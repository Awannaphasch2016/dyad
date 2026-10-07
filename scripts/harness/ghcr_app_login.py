#!/usr/bin/env python3
"""Mint a GitHub App installation token for GHCR and print only that token.

The private key is read from GH_APP_KEY. This script never prints the key.
`--self-test` checks JWT signing with a temporary key and does not call GitHub.
"""

import base64
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

APP_ID = "5221649"
INSTALLATION_ID = "168802279"


def b64url(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def sign_rs256(pem_text, message):
    key_path = None
    try:
        with tempfile.NamedTemporaryFile("w", delete=False) as handle:
            handle.write(pem_text)
            key_path = handle.name
        os.chmod(key_path, 0o600)
        result = subprocess.run(
            ["openssl", "dgst", "-sha256", "-sign", key_path],
            input=message,
            capture_output=True,
            check=False,
        )
    finally:
        if key_path and os.path.exists(key_path):
            os.remove(key_path)
    if result.returncode != 0:
        sys.stderr.write("openssl_sign_failed\n")
        raise SystemExit(1)
    return result.stdout


def make_jwt(pem_text):
    now = int(time.time())
    header = b64url(json.dumps({"alg": "RS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = b64url(
        json.dumps(
            {"iat": now - 60, "exp": now + 540, "iss": APP_ID},
            separators=(",", ":"),
        ).encode()
    )
    signing_input = f"{header}.{payload}".encode("ascii")
    signature = b64url(sign_rs256(pem_text, signing_input))
    return f"{header}.{payload}.{signature}"


def self_test():
    generated = subprocess.run(
        ["openssl", "genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048"],
        capture_output=True,
        check=False,
        text=True,
    )
    if generated.returncode != 0 or "PRIVATE KEY" not in generated.stdout:
        sys.stderr.write("self_test_keygen_failed\n")
        raise SystemExit(1)
    token = make_jwt(generated.stdout)
    segments = token.split(".")
    if len(segments) != 3 or any(len(part) < 8 for part in segments):
        sys.stderr.write("self_test_jwt_malformed\n")
        raise SystemExit(1)
    if "PRIVATE KEY" in token:
        sys.stderr.write("self_test_leaked_key\n")
        raise SystemExit(1)
    sys.stdout.write("self_test=ok\nsegments=3\n")


def installation_token(pem_text):
    jwt = make_jwt(pem_text)
    request = urllib.request.Request(
        f"https://api.github.com/app/installations/{INSTALLATION_ID}/access_tokens",
        data=b"{}",
        method="POST",
        headers={
            "Authorization": f"Bearer {jwt}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "dyad-harness-image",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = json.loads(response.read().decode("utf-8"))
            status = response.status
    except urllib.error.HTTPError as error:
        sys.stderr.write(f"installation_token_http {error.code}\n")
        raise SystemExit(1) from None
    token = body.get("token") if isinstance(body, dict) else None
    if status != 201 or not isinstance(token, str) or len(token) < 20:
        sys.stderr.write(f"installation_token_rejected {status}\n")
        raise SystemExit(1)
    return token


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--self-test":
        self_test()
        return
    pem_text = os.environ.get("GH_APP_KEY", "")
    if "PRIVATE KEY" not in pem_text:
        sys.stderr.write("missing_app_key\n")
        raise SystemExit(1)
    sys.stdout.write(installation_token(pem_text))


if __name__ == "__main__":
    main()
