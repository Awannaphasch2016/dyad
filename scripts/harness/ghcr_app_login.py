#!/usr/bin/env python3
"""Mint a GitHub App installation token for GHCR and print only that token.

The private key is read from GH_APP_KEY. This script never prints the key.
`--self-test` checks JWT signing with a temporary key and does not call GitHub.
"""

import base64
import json
import os
import re
import shutil
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
        error = result.stderr.decode("utf-8", "replace")
        error = re.sub(
            r"-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----",
            "[redacted-pem]",
            error,
        )
        error = re.sub(r"[A-Za-z0-9+/=]{40,}", "[redacted]", error)
        header = ""
        for line in pem_text.splitlines():
            if "BEGIN " in line:
                header = line.strip()
                break
        if "OPENSSH" in header:
            header_kind = "openssh"
        elif "RSA PRIVATE" in header:
            header_kind = "pkcs1"
        elif "ENCRYPTED" in header:
            header_kind = "encrypted"
        elif "PRIVATE KEY" in header:
            header_kind = "pkcs8"
        elif header:
            header_kind = "other"
        else:
            header_kind = "missing"
        error = error.replace("PRIVATE KEY", "key").replace("BEGIN ", "begin ")
        sys.stderr.write(
            "openssl_sign_failed"
            f" header_kind={header_kind}"
            f" pem_len={len(pem_text)}"
            f" pem_lines={pem_text.count(chr(10))}"
            f" {error[:180].strip()}\n"
        )
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
    formatted = format_permissions(
        {"packages": "write", "contents": "read", "token": "ghs_should_not_appear"}
    )
    if formatted != "contents=read,packages=write,token=other":
        sys.stderr.write("self_test_permission_format_failed\n")
        raise SystemExit(1)
    if "ghs_" in formatted:
        sys.stderr.write("self_test_permission_leaked\n")
        raise SystemExit(1)
    if (
        token_kind("") != "empty"
        or token_kind("ghp_" + ("a" * 36)) != "classic"
        or token_kind("github_pat_example") != "fine_grained"
    ):
        sys.stderr.write("self_test_token_kind_failed\n")
        raise SystemExit(1)
    sys.stdout.write("token_kind=ok\n")
    sys.stdout.write(f"permission_format={formatted}\n")
    encoded = base64.b64encode(generated.stdout.encode("utf-8")).decode("ascii")
    decoded = pem_from_text(encoded)
    if "PRIVATE KEY" not in decoded or decoded != generated.stdout:
        sys.stderr.write("self_test_base64_decode_failed\n")
        raise SystemExit(1)
    sys.stdout.write("self_test=ok\nsegments=3\n")


def format_permissions(permissions):
    if not isinstance(permissions, dict):
        return "none"
    parts = []
    for key in sorted(permissions):
        if not isinstance(key, str) or not re.fullmatch(r"[a-z_]{1,40}", key):
            continue
        value = permissions[key]
        if value not in {"read", "write", "admin"}:
            value = "other"
        parts.append(f"{key}={value}")
    return ",".join(parts) if parts else "none"


def safe_message(body):
    message = body.get("message") if isinstance(body, dict) else ""
    if not isinstance(message, str) or not re.fullmatch(r"[A-Za-z0-9 .,:'-]{1,120}", message):
        return ""
    return message


def github_request(method, url, bearer, payload=None):
    data = None
    headers = {
        "Authorization": f"Bearer {bearer}",
        "Accept": "application/vnd.github+json",
        "User-Agent": "dyad-harness-image",
    }
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read().decode("utf-8")
            status = response.status
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", "replace")
        status = error.code
    except urllib.error.URLError:
        return 0, {}
    try:
        body = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        body = {}
    return status, body


def mint_token(pem_text, payload):
    status, body = github_request(
        "POST",
        f"https://api.github.com/app/installations/{INSTALLATION_ID}/access_tokens",
        make_jwt(pem_text),
        payload,
    )
    if not isinstance(body, dict):
        body = {}
    token = body.get("token") if isinstance(body.get("token"), str) else ""
    body.pop("token", None)
    return status, body, token


def installation_token(pem_text):
    status, _body, token = mint_token(pem_text, {})
    if status != 201 or len(token) < 20:
        sys.stderr.write(f"installation_token_http {status}\n")
        raise SystemExit(1)
    return token


def restore_pem_lines(text):
    if text.count("\n") >= 2 or "PRIVATE KEY" not in text:
        return text
    match = re.search(r"(-----BEGIN [^-]+-----)\s*(.+?)\s*(-----END [^-]+-----)", text)
    if not match:
        return text
    body = re.sub(r"\s+", "", match.group(2))
    wrapped = "\n".join(body[i : i + 64] for i in range(0, len(body), 64))
    return f"{match.group(1)}\n{wrapped}\n{match.group(3)}\n"


def pem_from_text(text):
    if not text:
        return ""
    if "\\n" in text and text.count("\n") < 2:
        text = text.replace("\\n", "\n")
    text = restore_pem_lines(text)
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
    text = re.sub(r"ghp_[A-Za-z0-9]+", "[redacted]", text)
    text = re.sub(r"ghs_[A-Za-z0-9_]+", "[redacted]", text)
    text = re.sub(r"github_pat_[A-Za-z0-9_]+", "[redacted]", text)
    text = re.sub(r"[A-Za-z0-9+/=]{40,}", "[redacted]", text)
    return text


def token_kind(token):
    if not token:
        return "empty"
    if token.startswith("ghp_"):
        return "classic"
    if token.startswith("github_pat_"):
        return "fine_grained"
    if token.startswith("<+"):
        return "expression"
    return "other"


def docker_login(token, username="x-access-token"):
    if not token or len(token) < 20 or "PRIVATE KEY" in token:
        return False
    if username not in {"x-access-token", "Awannaphasch2016"}:
        return False
    result = subprocess.run(
        ["docker", "login", "ghcr.io", "-u", username, "--password-stdin"],
        input=token.encode("utf-8"),
        capture_output=True,
    )
    if result.returncode == 0:
        return True
    error = scrub_secret(result.stderr.decode("utf-8", "replace"), token)
    sys.stderr.write(f"docker_login_failed {error[:180].strip()}\n")
    return False


def emit(line):
    sys.stdout.write(line + "\n")
    sys.stdout.flush()


def package_facts(token, package):
    status, body = github_request(
        "GET",
        f"https://api.github.com/users/Awannaphasch2016/packages/container/{package}",
        token,
    )
    if not isinstance(body, dict):
        body = {}
    visibility = body.get("visibility") if isinstance(body.get("visibility"), str) else ""
    if visibility not in {"public", "private", "internal"}:
        visibility = "unknown" if status == 200 else "absent"
    repository = "none"
    linked = body.get("repository")
    if isinstance(linked, dict):
        full_name = linked.get("full_name")
        if isinstance(full_name, str) and re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", full_name):
            repository = full_name
    emit(
        f"package_http package={package} http={status}"
        f" visibility={visibility} repository={repository}"
    )


def delete_probe_tag(token):
    status, body = github_request(
        "GET",
        "https://api.github.com/users/Awannaphasch2016/packages/container/dyad/versions?per_page=20",
        token,
    )
    if not isinstance(body, list):
        emit(f"probe_tag_delete=list_http_{status}")
        return
    version_id = None
    for version in body:
        if not isinstance(version, dict):
            continue
        metadata = version.get("metadata")
        container = metadata.get("container") if isinstance(metadata, dict) else None
        tags = container.get("tags") if isinstance(container, dict) else None
        if isinstance(tags, list) and "harness-authprobe" in tags and isinstance(version.get("id"), int):
            version_id = version["id"]
            break
    if version_id is None:
        emit("probe_tag_delete=not_found")
        return
    deleted, _body = github_request(
        "DELETE",
        "https://api.github.com/users/Awannaphasch2016/packages/container/dyad/versions/"
        + str(version_id),
        token,
    )
    emit(f"probe_tag_delete={deleted}")


def push_scratch(token, login_label="app_key", username="x-access-token"):
    if not docker_login(token, username):
        emit("push_probe=login_failed")
        return
    emit(f"ghcr_login={login_label}")
    work = tempfile.mkdtemp()
    tag = "ghcr.io/awannaphasch2016/dyad:harness-authprobe"
    try:
        with open(os.path.join(work, "ok"), "w", encoding="utf-8") as handle:
            handle.write("ok\n")
        with open(os.path.join(work, "Dockerfile"), "w", encoding="utf-8") as handle:
            handle.write("FROM scratch\nCOPY ok /ok\n")
        build = subprocess.run(
            ["docker", "build", "-t", tag, work],
            capture_output=True,
            check=False,
        )
        if build.returncode != 0:
            emit("push_probe=build_failed")
            return
        push = subprocess.run(["docker", "push", tag], capture_output=True, check=False)
        text = scrub_secret(
            push.stderr.decode("utf-8", "replace") + push.stdout.decode("utf-8", "replace"),
            token,
        )
        if push.returncode == 0:
            result = "ok"
        elif "Write organization package" in text:
            result = "denied_organization_package"
        elif "denied" in text.lower():
            result = "denied"
        else:
            result = "failed"
        emit(f"push_probe={result} tag={tag}")
        if push.returncode == 0:
            delete_probe_tag(token)
    except FileNotFoundError:
        emit("push_probe=no_docker")
    finally:
        shutil.rmtree(work, ignore_errors=True)


def auth_probe():
    pem_text = load_pem()
    status, install = github_request(
        "GET",
        f"https://api.github.com/app/installations/{INSTALLATION_ID}",
        make_jwt(pem_text),
    )
    if not isinstance(install, dict):
        install = {}
    selection = install.get("repository_selection")
    if selection not in {"all", "selected"}:
        selection = "other" if status == 200 else "unknown"
    emit(
        "installation_http="
        + str(status)
        + " repository_selection="
        + selection
        + " permissions="
        + format_permissions(install.get("permissions"))
    )
    repo_status, repo_body = github_request(
        "GET",
        f"https://api.github.com/app/installations/{INSTALLATION_ID}/repositories?per_page=100",
        make_jwt(pem_text),
    )
    names = []
    repositories = repo_body.get("repositories") if isinstance(repo_body, dict) else None
    for repo in repositories or []:
        if not isinstance(repo, dict):
            continue
        name = repo.get("full_name")
        if isinstance(name, str) and re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", name):
            names.append(name)
    emit(
        "installation_repos http="
        + str(repo_status)
        + " count="
        + str(len(names))
        + " names="
        + ",".join(sorted(names))
    )
    explicit = {
        "repositories": ["dyad"],
        "permissions": {"packages": "write", "contents": "read", "metadata": "read"},
    }
    minted = {}
    for label, payload in (("explicit", explicit), ("default", {})):
        token_status, body, token = mint_token(pem_text, payload)
        emit(
            f"token_{label} http={token_status}"
            f" permissions={format_permissions(body.get('permissions'))}"
            f" message={safe_message(body)}"
        )
        if token_status == 201 and len(token) >= 20:
            minted[label] = (token, format_permissions(body.get("permissions")))
    chosen = ""
    for label in ("explicit", "default"):
        pair = minted.get(label)
        if pair and "packages=write" in pair[1]:
            chosen = pair[0]
            emit(f"push_token={label}")
            break
    if not chosen:
        for label in ("explicit", "default"):
            pair = minted.get(label)
            if pair:
                chosen = pair[0]
                emit(f"push_token={label}")
                break
    if not chosen:
        emit("push_probe=no_token")
        return
    for package in ("dyad", "gascity", "gascity-base"):
        package_facts(chosen, package)
    push_scratch(chosen)


def pat_probe():
    token = os.environ.get("GHCR_PUSH_TOKEN", "").strip()
    kind = token_kind(token)
    emit(f"push_token_kind={kind} token_len={len(token)}")
    if kind not in {"classic", "fine_grained", "other"} or len(token) < 20:
        emit("push_probe=no_pat")
        return
    push_scratch(token, login_label="pat", username="Awannaphasch2016")


def login_from_available_credentials():
    pat = os.environ.get("GHCR_PUSH_TOKEN", "").strip()
    if token_kind(pat) in {"classic", "fine_grained", "other"} and len(pat) >= 20:
        if docker_login(pat, "Awannaphasch2016"):
            sys.stderr.write("ghcr_login=pat\n")
            return
        raise SystemExit(1)
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
    if len(sys.argv) > 1 and sys.argv[1] == "--auth-probe":
        auth_probe()
        return
    if len(sys.argv) > 1 and sys.argv[1] == "--pat-probe":
        pat_probe()
        return
    sys.stdout.write(installation_token(load_pem()))


if __name__ == "__main__":
    main()
