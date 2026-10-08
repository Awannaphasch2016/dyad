#!/usr/bin/env python3
"""Harness OIDC claim probe and Doppler host-label printing.

The probe prints allowlisted claim names and values. It does not print the
JWT, a Doppler token, or a postgres URL.
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
from urllib.parse import urlparse

ACCOUNT = "WKxXBnSFTRaOF64-h90PyQ"
ISSUER = f"https://app.harness.io/ng/api/oidc/account/{ACCOUNT}"
AUDIENCE = "https://api.doppler.com"
PRODUCTION_HOST_LABEL = "ep-young-wave-b3cwe0rz-pooler"

CLAIM_ALLOWLIST = (
    "iss",
    "aud",
    "sub",
    "account_id",
    "organization_id",
    "project_id",
    "pipeline_id",
    "environment_id",
    "environment_type",
    "context",
)
TIME_CLAIMS = ("exp", "iat", "nbf")

JWT_RE = re.compile(r"eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}")
SECRET_RE = re.compile(
    r"postgres(?:ql)?://\S+"
    r"|dp\.[A-Za-z0-9]+\.\S+"
    r"|ghp_[A-Za-z0-9]+"
    r"|ghs_[A-Za-z0-9]+"
    r"|github_pat_[A-Za-z0-9_]+"
)


def scrub(text: str) -> str:
    cleaned = SECRET_RE.sub("[redacted]", text or "")
    return JWT_RE.sub("[redacted]", cleaned)


def b64url_json(segment: str) -> dict:
    padded = segment + "=" * ((4 - len(segment) % 4) % 4)
    raw = padded.replace("-", "+").replace("_", "/")
    import base64

    decoded = base64.b64decode(raw)
    payload = json.loads(decoded.decode("utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("payload_not_object")
    return payload


def decode_payload(token: str) -> dict:
    parts = token.split(".")
    if len(parts) != 3 or not all(parts):
        raise ValueError("not_jwt")
    return b64url_json(parts[1])


def find_jwt(value: object) -> str:
    if isinstance(value, str) and value.count(".") == 2:
        try:
            decode_payload(value)
        except (ValueError, json.JSONDecodeError):
            return ""
        return value
    if isinstance(value, dict):
        for item in value.values():
            found = find_jwt(item)
            if found:
                return found
    elif isinstance(value, list):
        for item in value:
            found = find_jwt(item)
            if found:
                return found
    return ""


def render_claim(value: object) -> str:
    rendered = json.dumps(value, separators=(",", ":"), sort_keys=True)
    if "*" in rendered or "?" in rendered:
        return "wildcard"
    return rendered


def claim_lines(payload: dict) -> list[str]:
    lines: list[str] = []
    wildcard = False
    for key in CLAIM_ALLOWLIST:
        if key not in payload:
            lines.append(f"claim_absent {key}")
            continue
        rendered = render_claim(payload[key])
        if rendered == "wildcard":
            wildcard = True
        lines.append(f"claim {key}={rendered}")
    for key in TIME_CLAIMS:
        if key in payload:
            lines.append(f"claim_time {key}=present")
    for key in sorted(payload):
        if key not in CLAIM_ALLOWLIST and key not in TIME_CLAIMS:
            lines.append(f"extra_claim_key={key}")
    lines.append("wildcard=" + ("yes" if wildcard else "no"))
    return lines


def host_label(url: str) -> str:
    host = urlparse(url).hostname or ""
    if not host or host.startswith("["):
        return ""
    return host.split(".")[0]


def canary_decision(label: str) -> str:
    if label == PRODUCTION_HOST_LABEL:
        return "production_host"
    return "no"


def print_claims_from_response(raw: str) -> int:
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        parsed = raw
    token = find_jwt(parsed)
    if not token:
        print("oidc_token=absent")
        print(scrub(raw)[:240])
        return 1
    lines = claim_lines(decode_payload(token))
    print("\n".join(lines))
    if any(line == "wildcard=yes" for line in lines):
        return 1
    return 0


def http_json(method: str, url: str, headers: dict[str, str], body: dict | None = None) -> tuple[int, object]:
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read().decode("utf-8", "replace")
            code = response.status
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", "replace")
        code = error.code
    try:
        parsed = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        print("response_not_json", scrub(raw)[:180])
        parsed = {}
    return code, parsed


def probe_harness() -> int:
    api_key = os.environ.get("HARNESS_API_KEY", "")
    if not api_key:
        print("harness_api_key=absent")
        return 1
    pipeline_id = "dyad_doppler_preview"
    environment_id = "preview"
    subject = (
        f"account/{ACCOUNT}:org/default:project/dyad:"
        f"pipeline/{pipeline_id}:environment/{environment_id}"
    )
    code, parsed = http_json(
        "POST",
        "https://app.harness.io/ng/api/oidc/id-token/custom",
        {"x-api-key": api_key, "Content-Type": "application/json"},
        {
            "accountId": ACCOUNT,
            "aud": AUDIENCE,
            "sub": subject,
            "oidcIdTokenCustomAttributesStructure": {
                "account_id": ACCOUNT,
                "organization_id": "default",
                "project_id": "dyad",
                "pipeline_id": pipeline_id,
                "environment_id": environment_id,
                "context": "PIPELINE_EXECUTION",
            },
        },
    )
    status = parsed.get("status") if isinstance(parsed, dict) else ""
    print("custom_token_http", code, status)
    if not isinstance(parsed, dict):
        return 1
    token = find_jwt(parsed)
    if not token:
        message = scrub(str(parsed.get("message") or ""))[:240]
        print("oidc_token=absent")
        if message:
            print("custom_token_message", message)
        return 1
    payload = decode_payload(token)
    lines = claim_lines(payload)
    print("\n".join(lines))
    signed_sub = payload.get("sub")
    print("sub_matches_request=" + ("yes" if signed_sub == subject else "no"))
    print("aud_matches_request=" + ("yes" if payload.get("aud") in (AUDIENCE, [AUDIENCE]) else "no"))
    return 1 if "wildcard=yes" in lines else 0


def list_field(parsed: object, key: str) -> list:
    if isinstance(parsed, dict):
        value = parsed.get(key)
        if isinstance(value, list):
            return value
        data = parsed.get("data")
        if isinstance(data, dict) and isinstance(data.get(key), list):
            return data[key]
        if isinstance(data, list):
            return data
    if isinstance(parsed, list):
        return parsed
    return []


def probe_doppler() -> int:
    token = os.environ.get("DOPPLER_ADMIN_TOKEN", "")
    if not token:
        print("doppler_admin=absent")
        return 0
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    code, parsed = http_json("GET", "https://api.doppler.com/v3/workplace/service_accounts", headers)
    print("doppler_service_accounts_http", code)
    accounts = list_field(parsed, "service_accounts")
    if code != 200:
        message = ""
        if isinstance(parsed, dict):
            message = scrub(str(parsed.get("message") or parsed.get("messages") or ""))[:180]
        if message:
            print("doppler_service_accounts_message", message)
        return 0
    for account in accounts:
        if not isinstance(account, dict):
            continue
        slug = str(account.get("slug") or "")
        name = str(account.get("name") or "")
        print(f"service_account slug={slug} name={name}")
        id_code, identities = http_json(
            "GET",
            f"https://api.doppler.com/v3/workplace/service_accounts/service_account/{slug}/identities",
            headers,
        )
        print(f"identities_http slug={slug} http={id_code}")
        for identity in list_field(identities, "identities"):
            if not isinstance(identity, dict):
                continue
            config = identity.get("config") if isinstance(identity.get("config"), dict) else {}
            claims_type = str(config.get("claims_type") or "")
            claims = config.get("claims") if isinstance(config.get("claims"), dict) else {}
            wildcard = "yes" if "*" in json.dumps(claims) or "?" in json.dumps(claims) else "no"
            print(
                "identity"
                f" slug={slug}"
                f" id={identity.get('id') or identity.get('identity') or ''}"
                f" name={identity.get('name') or ''}"
                f" claims_type={claims_type}"
                f" wildcard={wildcard}"
            )
    for project in ("dyad", "aws"):
        env_code, environments = http_json(
            "GET",
            f"https://api.doppler.com/v3/environments?project={project}",
            headers,
        )
        print(f"environments_http project={project} http={env_code}")
        for environment in list_field(environments, "environments"):
            if isinstance(environment, dict):
                print(
                    f"environment project={project} slug={environment.get('slug') or environment.get('id') or ''}"
                )
        cfg_code, configs = http_json(
            "GET",
            f"https://api.doppler.com/v3/configs?project={project}",
            headers,
        )
        print(f"configs_http project={project} http={cfg_code}")
        for config in list_field(configs, "configs"):
            if isinstance(config, dict):
                print(
                    f"config project={project} name={config.get('name') or ''} "
                    f"environment={config.get('environment') or ''}"
                )
    return 0


def self_test() -> int:
    import base64

    def segment(value: dict) -> str:
        raw = json.dumps(value, separators=(",", ":")).encode("utf-8")
        return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")

    email = "hidden@example.com"
    payload = {
        "iss": ISSUER,
        "aud": AUDIENCE,
        "sub": (
            f"account/{ACCOUNT}:org/default:project/dyad:"
            "pipeline/dyad_doppler_preview:environment/preview"
        ),
        "account_id": ACCOUNT,
        "organization_id": "default",
        "project_id": "dyad",
        "pipeline_id": "dyad_doppler_preview",
        "environment_id": "preview",
        "exp": 1,
        "iat": 1,
        "trigger_by_email": email,
    }
    token = f"{segment({'alg': 'none'})}.{segment(payload)}.signature"
    lines = claim_lines(decode_payload(token))
    output = "\n".join(lines)
    url = "postgres://user:secret@ep-muddy-sky-b31adt7z-pooler.example.com/db"
    label = host_label(url)
    refused = canary_decision(PRODUCTION_HOST_LABEL)
    allowed = canary_decision(label)
    scrubbed = scrub(url + " dp.st.secret " + token)
    checks = {
        "wildcard": "wildcard=no" in output,
        "pipeline": "claim pipeline_id=" in output,
        "environment": "claim environment_id=" in output,
        "email_hidden": email not in output,
        "extra_key": "extra_claim_key=trigger_by_email" in output,
        "host_label": label == "ep-muddy-sky-b31adt7z-pooler",
        "endpoint_line": "postgres://" not in f"db_endpoint={label}",
        "refused": refused == "production_host",
        "allowed": allowed == "no",
        "scrub_url": "postgres://" not in scrubbed,
        "scrub_doppler": "dp.st." not in scrubbed,
        "scrub_email": email not in scrubbed,
        "scrub_token": token not in scrubbed,
        "scrub_user": "user:secret" not in f"db_endpoint={label}",
    }
    failed = [name for name, ok in checks.items() if not ok]
    if failed:
        print("self_test=fail " + ",".join(failed))
        return 1
    print("self_test=ok")
    print("host_label=ep-muddy-sky-b31adt7z-pooler")
    print("canary_refused=production_host")
    print("wildcard=no")
    return 0


def main(argv: list[str]) -> int:
    if argv == ["--self-test"]:
        return self_test()
    if argv == ["probe-once"]:
        harness_status = probe_harness()
        doppler_status = probe_doppler()
        return harness_status or doppler_status
    print("usage")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
