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
    encoded = base64.b64encode(generated.stdout.encode("utf-8")).decode("ascii")
    decoded = pem_from_text(encoded)
    if "PRIVATE KEY" not in decoded or decoded != generated.stdout:
        sys.stderr.write("self_test_base64_decode_failed\n")
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


def pem_from_text(text):
    if not text:
        return ""
    if "\\n" in text and text.count("\n") < 2:
        text = text.replace("\\n", "\n")
    if "PRIVATE KEY" in text and len(text) > 200:
        return text
    compact = "".join(text.split())
    if len(compact) < 40:
        return ""
    try:
        decoded = base64.b64decode(compact, validate=True)
        decoded_text = decoded.decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return ""
    if "PRIVATE KEY" in decoded_text and len(decoded_text) > 200:
        return decoded_text
    return ""


def text_from_candidate(candidate):
    if os.path.isfile(candidate):
        file_text = open(candidate, encoding="utf-8").read()
        found = pem_from_text(file_text)
        if found:
            return found
        nested = file_text.strip()
        if nested and "\n" not in nested and nested != candidate and os.path.isfile(nested):
            found = pem_from_text(open(nested, encoding="utf-8").read())
            if found:
                return found
        return ""
    return pem_from_text(candidate)


def load_pem():
    file_candidate = os.environ.get("GH_APP_KEY_FILE", "")
    env_candidate = os.environ.get("GH_APP_KEY", "")
    if file_candidate:
        found = text_from_candidate(file_candidate)
        if found:
            return found
    if env_candidate:
        found = text_from_candidate(env_candidate)
        if found:
            return found
    saw = env_candidate or file_candidate
    if not saw:
        kind = "empty"
    elif saw.startswith("<+"):
        kind = "expression"
    elif saw.startswith("/"):
        kind = "path"
    else:
        kind = "other"
    file_text = ""
    if file_candidate and os.path.isfile(file_candidate):
        file_text = open(file_candidate, encoding="utf-8").read()
    sys.stderr.write(
        "missing_app_key"
        f" kind={kind}"
        f" env_len={len(env_candidate)}"
        f" file_len={len(file_text)}"
        f" file_lines={file_text.count(chr(10))}"
        f" file_has_header={int('PRIVATE KEY' in file_text)}\n"
    )
    raise SystemExit(1)


def scrub_secret(text, secret):
    if secret and secret in text:
        text = text.replace(secret, "[redacted]")
    return text


def docker_login(token):
    if not token or len(token) < 20 or "PRIVATE KEY" in token:
        return False
    result = subprocess.run(
        ["docker", "login", "ghcr.io", "-u", "x-access-token", "--password-stdin"],
        input=token.encode("utf-8"),
        capture_output=True,
    )
    if result.returncode == 0:
        return True
    error = scrub_secret(result.stderr.decode("utf-8", "replace"), token)
    sys.stderr.write(f"docker_login_failed {error[:180].strip()}\n")
    return False


def login_from_available_credentials():
    if docker_login(installation_token(load_pem())):
        sys.stderr.write("ghcr_login=app_key\n")
        return
    raise SystemExit(1)


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--self-test":
        self_test()
        return
    if len(sys.argv) > 1 and sys.argv[1] == "--docker-login":
        login_from_available_credentials()
        return
    sys.stdout.write(installation_token(load_pem()))


if __name__ == "__main__":
    main()
