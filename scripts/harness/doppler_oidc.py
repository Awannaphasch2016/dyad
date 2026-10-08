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


def failure_fields(parsed: dict) -> None:
    print("response_keys", ",".join(sorted(parsed)))
    code = parsed.get("code")
    if code:
        print("response_code", code)
    correlation = parsed.get("correlationId")
    if isinstance(correlation, str) and correlation:
        print("correlation_id", correlation[:80])
    message = scrub(str(parsed.get("message") or ""))[:240]
    if message:
        print("custom_token_message", message)
    detailed = scrub(str(parsed.get("detailedMessage") or ""))[:240]
    if detailed:
        print("custom_token_detail", detailed)


def token_request(api_key: str, url: str, body: dict) -> tuple[int, dict, str]:
    code, parsed = http_json(
        "POST",
        url,
        {"x-api-key": api_key, "Content-Type": "application/json"},
        body,
    )
    if not isinstance(parsed, dict):
        return code, {}, ""
    return code, parsed, find_jwt(parsed)


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
    attributes = {
        "account_id": ACCOUNT,
        "organization_id": "default",
        "project_id": "dyad",
        "pipeline_id": pipeline_id,
        "environment_id": environment_id,
        "context": "PIPELINE_EXECUTION",
    }
    minimal = {
        "accountId": ACCOUNT,
        "aud": AUDIENCE,
        "oidcIdTokenCustomAttributesStructure": {"account_id": ACCOUNT},
    }
    full = {
        "accountId": ACCOUNT,
        "aud": AUDIENCE,
        "sub": subject,
        "oidcIdTokenCustomAttributesStructure": attributes,
    }
    existing = {
        "accountId": ACCOUNT,
        "aud": AUDIENCE,
        "oidcIdTokenCustomAttributesStructure": {
            "account_id": ACCOUNT,
            "organization_id": "default",
            "project_id": "dyad",
            "pipeline_id": "dyad_harness_images",
        },
    }
    direct = "https://app.harness.io/ng/api/oidc/id-token/custom"
    gateway = (
        "https://app.harness.io/gateway/ng/api/oidc/id-token/custom"
        f"?accountIdentifier={ACCOUNT}"
    )
    attempts = (
        ("minimal", direct, minimal),
        ("full", direct, full),
        ("existing_pipeline", direct, existing),
        ("gateway_minimal", gateway, minimal),
    )
    last: dict = {}
    for name, url, body in attempts:
        code, parsed, token = token_request(api_key, url, body)
        status = parsed.get("status") if parsed else ""
        print(f"custom_token_http attempt={name}", code, status)
        last = parsed
        if not token:
            continue
        payload = decode_payload(token)
        print(f"oidc_token=present attempt={name}")
        lines = claim_lines(payload)
        print("\n".join(lines))
        signed_sub = payload.get("sub")
        print("sub_matches_request=" + ("yes" if signed_sub == subject else "no"))
        print(
            "aud_matches_request="
            + ("yes" if payload.get("aud") in (AUDIENCE, [AUDIENCE]) else "no")
        )
        return 1 if "wildcard=yes" in lines else 0
    print("oidc_token=absent")
    if last:
        failure_fields(last)
    return 1


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
            rendered_claims = json.dumps(claims, sort_keys=True)
            wildcard = "yes" if "*" in rendered_claims or "?" in rendered_claims else "no"
            print("identity_keys", ",".join(sorted(identity)))
            print("identity_config_keys", ",".join(sorted(config)))
            print(
                "identity"
                f" slug={slug}"
                f" name={identity.get('name') or ''}"
                f" claims_type={claims_type}"
                f" wildcard={wildcard}"
            )
            for key, value in identity.items():
                if isinstance(value, str) and re.fullmatch(
                    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
                    value,
                    re.I,
                ):
                    print(f"identity_uuid field={key} value={value}")
            print("identity_claims", scrub(rendered_claims)[:500])
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
    import io
    from contextlib import redirect_stdout

    os.environ["PLUGIN_OIDC_TOKEN_ID"] = token
    os.environ.pop("HARNESS_WI_HANDLE", None)
    os.environ.pop("HARNESS_WI_MINT_URL", None)
    buffer = io.StringIO()
    try:
        with redirect_stdout(buffer):
            runtime_status = runtime_claims()
    finally:
        os.environ.pop("PLUGIN_OIDC_TOKEN_ID", None)
    runtime_output = buffer.getvalue()
    checks["runtime_status"] = runtime_status == 0
    checks["runtime_present"] = "oidc_env=present" in runtime_output
    checks["runtime_claim"] = "claim pipeline_id=" in runtime_output
    checks["runtime_hidden"] = token not in runtime_output and email not in runtime_output
    failed = [name for name, ok in checks.items() if not ok]
    if failed:
        print("self_test=fail " + ",".join(failed))
        return 1
    print("self_test=ok")
    print("host_label=ep-muddy-sky-b31adt7z-pooler")
    print("canary_refused=production_host")
    print("wildcard=no")
    return 0


def runtime_claims() -> int:
    for key in sorted(os.environ):
        upper = key.upper()
        if "OIDC" in upper or upper.startswith("HARNESS_WI") or "JWT" in upper:
            print(f"env_name={key}")
    token = os.environ.get("PLUGIN_OIDC_TOKEN_ID", "")
    print("oidc_env=" + ("present" if token else "absent"))
    if token:
        try:
            print("\n".join(claim_lines(decode_payload(token))))
        except (ValueError, json.JSONDecodeError):
            print("oidc_claims=unreadable")
    handle = os.environ.get("HARNESS_WI_HANDLE", "")
    mint = os.environ.get("HARNESS_WI_MINT_URL", "")
    print("wi_handle=" + ("present" if handle else "absent"))
    scheme = mint.split(":", 1)[0] if mint else "absent"
    if scheme not in {"http", "https", "absent"}:
        scheme = "other"
    print(f"wi_mint_scheme={scheme}")
    for name in ("preview",):
        minted = find_jwt(os.environ.get(name, ""))
        if not minted:
            print(f"identity_env=absent name={name}")
            continue
        print(f"identity_env=present name={name}")
        try:
            print("\n".join(claim_lines(decode_payload(minted))))
        except (ValueError, json.JSONDecodeError):
            print("identity_claims=unreadable")
    hcli = shutil_which("hcli")
    print("hcli=" + ("present" if hcli else "absent"))
    if hcli:
        mint_named_identity(hcli, "preview")
    if not handle or not mint.startswith(("http://", "https://")):
        return 0
    code, parsed = http_json(
        "POST",
        mint,
        {"Content-Type": "application/json"},
        {"handle": handle, "name": "doppler"},
    )
    print("mint_http", code)
    minted = ""
    if isinstance(parsed, dict):
        candidate = parsed.get("oidc_token") or parsed.get("token") or ""
        if isinstance(candidate, str):
            minted = candidate
        error = parsed.get("error")
        if isinstance(error, str) and error:
            print("mint_error", scrub(error)[:180])
    if not minted:
        print("mint_token=absent")
        return 0
    try:
        print("\n".join(claim_lines(decode_payload(minted))))
    except (ValueError, json.JSONDecodeError):
        print("mint_claims=unreadable")
    return 0


def mint_named_identity(binary: str, name: str) -> None:
    import subprocess

    args = [binary, "identity", "token", "--name", name, "--audience", AUDIENCE]
    try:
        result = subprocess.run(args, text=True, capture_output=True, timeout=20)
    except (OSError, subprocess.TimeoutExpired) as error:
        print("hcli_cmd", "identity token", "error", type(error).__name__)
        return
    print("hcli_cmd", "identity token", "exit", result.returncode)
    minted = find_jwt((result.stdout or "").strip())
    if minted:
        print(f"hcli_token=present name={name}")
        try:
            print("\n".join(claim_lines(decode_payload(minted))))
        except (ValueError, json.JSONDecodeError):
            print("hcli_claims=unreadable")
        return
    text = scrub((result.stdout or "") + "\n" + (result.stderr or ""))
    shown = 0
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        print("hcli_help", stripped[:200])
        shown += 1
        if shown >= 12:
            break


def shutil_which(name: str) -> str:
    import shutil

    return shutil.which(name) or ""


def harness_request(
    api_key: str,
    method: str,
    url: str,
    yaml_text: str | None = None,
    payload: dict | None = None,
) -> tuple[int, dict]:
    headers = {"x-api-key": api_key}
    body = None
    if yaml_text is not None:
        headers["Content-Type"] = "application/yaml"
        body = yaml_text.encode("utf-8")
    elif payload is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read().decode("utf-8", "replace")
            code = response.status
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", "replace")
        code = error.code
    try:
        parsed = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        parsed = {"message": scrub(raw)[:240]}
    return code, parsed if isinstance(parsed, dict) else {}


def print_saved_identities(parsed: dict) -> None:
    blobs: list[str] = []

    def walk(value: object) -> None:
        if isinstance(value, str) and "identit" in value.lower():
            blobs.append(value)
        elif isinstance(value, dict):
            for item in value.values():
                walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)

    walk(parsed)
    print("saved_identity_blobs", len(blobs))
    shown = 0
    for blob in blobs:
        for line in blob.splitlines():
            if not any(
                word in line
                for word in (
                    "identit",
                    "audience",
                    "subject",
                    "pipeline_id",
                    "environment_id",
                    "tokenMode",
                )
            ):
                continue
            print("saved", scrub(line.strip())[:220])
            shown += 1
            if shown >= 20:
                return


def interesting_log_line(text: str) -> bool:
    markers = (
        "env_name=",
        "oidc_env=",
        "oidc_claims=",
        "wi_handle=",
        "wi_mint_scheme=",
        "hcli=",
        "hcli_cmd",
        "hcli_help",
        "identity_env=",
        "identity_claims=",
        "hcli_token=",
        "hcli_claims=",
        "mint_http",
        "mint_error",
        "mint_token=",
        "mint_claims=",
        "claim ",
        "claim_absent",
        "claim_time",
        "wildcard=",
        "extra_claim_key=",
    )
    return any(marker in text for marker in markers)


def print_step_logs(api_key: str, account: str, execution: str) -> None:
    import time
    import zipfile
    from pathlib import Path
    from urllib.parse import quote

    code, detail = harness_request(
        api_key,
        "GET",
        "https://app.harness.io/pipeline/api/pipelines/execution/v2/"
        f"{execution}?accountIdentifier={account}&orgIdentifier=default"
        "&projectIdentifier=dyad&renderFullBottomGraph=true",
    )
    print("detail_http", code)
    graph = (((detail.get("data") or {}).get("executionGraph") or {}).get("nodeMap") or {})
    if not isinstance(graph, dict):
        return
    for node in graph.values():
        if not isinstance(node, dict):
            continue
        ident = str(node.get("identifier") or "")
        if ident != "print_oidc_claims":
            continue
        print("step", ident, node.get("status"))
        print("step_keys", ",".join(sorted(str(key) for key in node)))
        params = node.get("stepParameters")
        if isinstance(params, dict):
            print("step_param_keys", ",".join(sorted(str(key) for key in params)))
            identities = params.get("identities")
            if identities is not None:
                print("step_identities", scrub(json.dumps(identities))[:800])
        elif isinstance(params, str):
            print("step_parameters", scrub(params)[:800])
        key = node.get("logBaseKey")
        if not isinstance(key, str) or not key:
            print("log_key=absent")
            return
        link = ""
        for _ in range(12):
            log_code, log_body = harness_request(
                api_key,
                "POST",
                "https://app.harness.io/gateway/log-service/blob/download"
                f"?accountID={account}&prefix={quote(key, safe='')}",
                payload={},
            )
            log_status = log_body.get("status") if isinstance(log_body, dict) else ""
            print("log_http", log_code, log_status)
            if log_status == "success" and isinstance(log_body.get("link"), str):
                link = log_body["link"]
                break
            time.sleep(3)
        if not link:
            print("log_link=absent")
            return
        log_file = Path("/tmp/harness-oidc-step.log")
        log_file.unlink(missing_ok=True)
        download = urllib.request.urlopen(link, timeout=60)
        log_file.write_bytes(download.read())
        download.close()
        chunks: list[str] = []
        if zipfile.is_zipfile(log_file):
            with zipfile.ZipFile(log_file) as archive:
                print("log_entries", len(archive.namelist()))
                for name in archive.namelist():
                    chunks.append(archive.read(name).decode("utf-8", "replace"))
        else:
            chunks.append(log_file.read_text("utf-8", "replace"))
        log_file.unlink(missing_ok=True)
        shown = 0
        for raw_log in chunks:
            for line in raw_log.splitlines():
                if "PRIVATE KEY" in line or "BEGIN " in line:
                    continue
                text = line
                try:
                    parsed = json.loads(line)
                except json.JSONDecodeError:
                    text = line
                else:
                    text = ""
                    if isinstance(parsed, dict):
                        for field in ("out", "message", "log", "text"):
                            value = parsed.get(field)
                            if isinstance(value, str) and value:
                                text = value
                                break
                if not interesting_log_line(text):
                    continue
                print("log", scrub(text)[:300])
                shown += 1
        print("log_matches", shown)


def print_feature_flags(api_key: str) -> None:
    urls = (
        "https://app.harness.io/ng/api/feature-flags?accountIdentifier=" + ACCOUNT,
        "https://app.harness.io/gateway/ng/api/feature-flags?accountIdentifier=" + ACCOUNT,
    )
    for url in urls:
        code, parsed = harness_request(api_key, "GET", url)
        print(
            "feature_flags_http",
            code,
            parsed.get("status"),
            scrub(str(parsed.get("message") or ""))[:180],
        )
        data = parsed.get("data")
        flags = data if isinstance(data, list) else []
        if isinstance(data, dict):
            for key in ("featureFlags", "flags", "featureFlagList"):
                if isinstance(data.get(key), list):
                    flags = data[key]
                    break
        print("feature_flag_count", len(flags))
        shown = 0
        for flag in flags:
            if isinstance(flag, str):
                name = flag
                enabled = "yes"
            elif isinstance(flag, dict):
                name = str(flag.get("name") or flag.get("featureName") or flag.get("identifier") or "")
                enabled_value = flag.get("enabled")
                enabled = "yes" if enabled_value is True else "no" if enabled_value is False else "unknown"
            else:
                continue
            lowered = name.lower()
            if not any(word in lowered for word in ("oidc", "identity", "workload")):
                continue
            print(f"feature_flag name={name} enabled={enabled}")
            shown += 1
        print("feature_flag_matches", shown)
        if code == 200:
            return


def register_probe() -> int:
    import time
    from pathlib import Path

    api_key = os.environ.get("HARNESS_API_KEY", "")
    if not api_key:
        print("harness_api_key=absent")
        return 1
    account = ACCOUNT
    pipeline = "dyad_oidc_probe"
    print_feature_flags(api_key)
    yaml_text = Path("deploy/harness/oidc-probe.yaml").read_text("utf-8")
    query = f"?accountIdentifier={account}&orgIdentifier=default&projectIdentifier=dyad"
    code, body = harness_request(
        api_key,
        "POST",
        f"https://app.harness.io/pipeline/api/pipelines/v2{query}",
        yaml_text=yaml_text,
    )
    message = scrub(str(body.get("message") or ""))[:300]
    print("create_pipeline", code, body.get("status"), message)
    if code not in {200, 201}:
        code, body = harness_request(
            api_key,
            "PUT",
            f"https://app.harness.io/pipeline/api/pipelines/v2/{pipeline}{query}",
            yaml_text=yaml_text,
        )
        print(
            "update_pipeline",
            code,
            body.get("status"),
            scrub(str(body.get("message") or ""))[:300],
        )
        if code not in {200, 201}:
            return 1
    saved_code, saved = harness_request(
        api_key,
        "GET",
        f"https://app.harness.io/pipeline/api/pipelines/v2/{pipeline}{query}",
    )
    print(
        "saved_pipeline",
        saved_code,
        saved.get("status"),
        scrub(str(saved.get("message") or ""))[:200],
    )
    if saved_code != 200:
        saved_code, saved = harness_request(
            api_key,
            "GET",
            "https://app.harness.io/pipeline/api/pipelines/"
            f"{pipeline}?accountIdentifier={account}&orgIdentifier=default&projectIdentifier=dyad",
        )
        print(
            "saved_pipeline_v1",
            saved_code,
            saved.get("status"),
            scrub(str(saved.get("message") or ""))[:200],
        )
    print_saved_identities(saved)
    execute_yaml = (
        "pipeline:\n"
        f"  identifier: {pipeline}\n"
        "  properties:\n"
        "    ci:\n"
        "      codebase:\n"
        "        build:\n"
        "          type: branch\n"
        "          spec:\n"
        "            branch: cursor/harness-doppler-5527\n"
    )
    code, body = harness_request(
        api_key,
        "POST",
        "https://app.harness.io/pipeline/api/pipeline/execute/"
        f"{pipeline}{query}&moduleType=CI",
        yaml_text=execute_yaml,
    )
    data = body.get("data") if isinstance(body.get("data"), dict) else {}
    plan = data.get("planExecution") if isinstance(data.get("planExecution"), dict) else {}
    execution = (
        data.get("planExecutionId")
        or data.get("uuid")
        or plan.get("uuid")
        or plan.get("planExecutionId")
        or ""
    )
    print("execute", code, body.get("status"), execution)
    if code not in {200, 201} or not execution:
        print("execute_message", scrub(str(body.get("message") or ""))[:300])
        return 1
    terminal = {"Success", "Failed", "Errored", "Expired", "Aborted"}
    status = "Unknown"
    summary_url = (
        "https://app.harness.io/pipeline/api/pipelines/execution/summary"
        f"?accountIdentifier={account}&orgIdentifier=default&projectIdentifier=dyad"
        f"&pipelineIdentifier={pipeline}&page=0&size=5"
    )
    for _ in range(45):
        summary_code, summary_body = harness_request(
            api_key,
            "POST",
            summary_url,
            payload={"filterType": "PipelineExecution"},
        )
        rows = []
        summary_data = summary_body.get("data")
        if isinstance(summary_data, dict) and isinstance(summary_data.get("content"), list):
            rows = summary_data["content"]
        status = "Missing"
        for row in rows:
            if isinstance(row, dict) and row.get("planExecutionId") == execution:
                status = str(row.get("status") or "Unknown")
                break
        print("poll", summary_code, status)
        if status in terminal:
            break
        time.sleep(20)
    print_step_logs(api_key, account, str(execution))
    print("final", status)
    return 0 if status == "Success" else 1


def main(argv: list[str]) -> int:
    if argv == ["--self-test"]:
        return self_test()
    if argv == ["probe-once"]:
        harness_status = probe_harness()
        doppler_status = probe_doppler()
        return harness_status or doppler_status
    if argv == ["runtime-claims"]:
        return runtime_claims()
    if argv == ["register-probe"]:
        return register_probe()
    print("usage")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
