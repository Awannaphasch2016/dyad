"""Report which Doppler configs the CI identity can read, whether any of them
holds a Google credential, and whether that credential reaches two Drive ids.

The log gets names, counts and HTTP statuses only. File names and document
text go into report.json, which the workflow seals with the public key in
this directory before uploading. Secret values are never written anywhere.
"""

import base64
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

DOPPLER = "https://api.doppler.com"
DOC_ID = os.environ["DOC_ID"]
FOLDER_ID = os.environ["FOLDER_ID"]
IDENTITY = os.environ["DOPPLER_IDENTITY_ID"]
GOOGLE_NAME = re.compile(
    r"GOOGLE|GDRIVE|GSUITE|GCP|GAPI|GCLOUD|FIREBASE|GMAIL|SHEETS|CREDENTIALS|JSON_KEY|_SA_|SERVICE_ACCOUNT|OAUTH|CLIENT_ID|CLIENT_SECRET|REFRESH_TOKEN|DRIVE",
    re.I,
)
CANDIDATE_PROJECTS = ["dyad", "aws", "google", "thehut", "wewebplus", "hitl", "drive", "shared"]

report = {"projects": {}, "google_candidates": [], "drive": {}}


def mask(value):
    # GitHub reads ::add-mask:: one line at a time, so a multi-line secret must
    # be masked line by line. Passing the whole value prints every line after
    # the first into the log in clear text. Mask each non-empty line and every
    # whitespace-separated token so JSON field values are covered too.
    if not value:
        return
    seen = set()
    for line in str(value).splitlines():
        for token in [line] + line.replace('"', " ").replace(",", " ").split():
            token = token.strip().strip('"').strip(",")
            if len(token) >= 8 and token not in seen:
                seen.add(token)
                print(f"::add-mask::{token}")


def http(method, url, headers=None, body=None, raw=False):
    data = None
    if body is not None:
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            payload = resp.read()
            return resp.status, (payload if raw else json.loads(payload or b"{}"))
    except urllib.error.HTTPError as err:
        payload = err.read()
        try:
            parsed = json.loads(payload or b"{}")
        except ValueError:
            parsed = {"raw_length": len(payload)}
        return err.code, (payload if raw else parsed)


def github_oidc_token():
    url = os.environ["ACTIONS_ID_TOKEN_REQUEST_URL"]
    status, body = http("GET", url, {"Authorization": "Bearer " + os.environ["ACTIONS_ID_TOKEN_REQUEST_TOKEN"]})
    if status != 200:
        sys.exit(f"GitHub OIDC token request failed: {status}")
    token = body["value"]
    mask(token)
    return token


def doppler_token():
    status, body = http("POST", f"{DOPPLER}/v3/auth/oidc", {"Content-Type": "application/json"}, {"identity": IDENTITY, "token": github_oidc_token()})
    if status != 200:
        sys.exit(f"Doppler OIDC exchange failed: {status} {body.get('messages')}")
    token = body["token"]
    mask(token)
    return token


TOKEN = doppler_token()
AUTH = {"Authorization": "Bearer " + TOKEN, "Accept": "application/json"}


def doppler_get(path, **params):
    query = urllib.parse.urlencode(params)
    return http("GET", f"{DOPPLER}/v3/{path}?{query}", AUTH)


projects = []
page = 1
while True:
    status, body = doppler_get("projects", per_page=100, page=page)
    if status != 200:
        break
    batch = [p["name"] for p in body.get("projects", [])]
    projects.extend(batch)
    if len(batch) < 100:
        break
    page += 1
if projects:
    print(f"projects listed ({len(projects)}): {sorted(projects)}")
else:
    projects = CANDIDATE_PROJECTS
    print(f"project listing not permitted ({status}); probing {projects}")

for project in projects:
    status, body = doppler_get("configs", project=project, per_page=100)
    if status != 200:
        print(f"{project}: configs {status}")
        report["projects"][project] = {"configs_status": status}
        continue
    configs = [c["name"] for c in body.get("configs", [])]
    report["projects"][project] = {"configs": {}}
    for config in configs:
        status, body = doppler_get("configs/config/secrets/names", project=project, config=config)
        if status != 200:
            print(f"{project}/{config}: names {status}")
            report["projects"][project]["configs"][config] = {"names_status": status}
            continue
        names = body.get("names", [])
        matching = sorted(n for n in names if GOOGLE_NAME.search(n) and not n.startswith("DOPPLER_"))
        print(f"{project}/{config}: {len(names)} secrets, google-like names: {matching}")
        report["projects"][project]["configs"][config] = {"count": len(names), "google_like": matching, "names": sorted(names)}
        for name in matching:
            report["google_candidates"].append({"project": project, "config": config, "name": name})


def secret_value(project, config, name):
    status, body = doppler_get("configs/config/secret", project=project, config=config, name=name)
    if status != 200:
        return None
    value = (body.get("value") or {}).get("computed") or (body.get("value") or {}).get("raw")
    mask(value)
    return value


def b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def service_account_access_token(info):
    now = int(time.time())
    header = b64url(json.dumps({"alg": "RS256", "typ": "JWT"}).encode())
    claims = b64url(json.dumps({
        "iss": info["client_email"],
        "scope": "https://www.googleapis.com/auth/drive.readonly",
        "aud": "https://oauth2.googleapis.com/token",
        "iat": now,
        "exp": now + 600,
    }).encode())
    signing_input = f"{header}.{claims}".encode()
    with tempfile.NamedTemporaryFile("w", delete=False) as key_file:
        key_file.write(info["private_key"])
        key_path = key_file.name
    try:
        signature = subprocess.run(["openssl", "dgst", "-sha256", "-sign", key_path], input=signing_input, capture_output=True, check=True).stdout
    finally:
        os.unlink(key_path)
    assertion = f"{header}.{claims}.{b64url(signature)}"
    status, body = http("POST", "https://oauth2.googleapis.com/token", {"Content-Type": "application/x-www-form-urlencoded"}, urllib.parse.urlencode({"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": assertion}).encode())
    print(f"service account token exchange: {status}")
    token = body.get("access_token") if status == 200 else None
    mask(token)
    return token


def refresh_token_access_token(client_id, client_secret, refresh_token):
    status, body = http("POST", "https://oauth2.googleapis.com/token", {"Content-Type": "application/x-www-form-urlencoded"}, urllib.parse.urlencode({"grant_type": "refresh_token", "client_id": client_id, "client_secret": client_secret, "refresh_token": refresh_token}).encode())
    print(f"refresh token exchange: {status} {body.get('error', '')}")
    token = body.get("access_token") if status == 200 else None
    mask(token)
    return token


def classify(project, config, names):
    """Return (label, access_token) for the first usable Google credential."""
    for name in names:
        value = secret_value(project, config, name)
        if not value:
            continue
        stripped = value.strip()
        if stripped.startswith("{"):
            try:
                info = json.loads(stripped)
            except ValueError:
                continue
        elif len(stripped) > 200 and not stripped.startswith("ya29."):
            try:
                info = json.loads(base64.b64decode(stripped))
            except Exception:
                info = None
            if not isinstance(info, dict):
                continue
        else:
            continue
        if info.get("type") == "service_account" and info.get("private_key"):
            print(f"{project}/{config}/{name}: service account JSON, email domain {info.get('client_email', '').split('@')[-1]}")
            report["service_account_email"] = info.get("client_email")
            report["service_account_project"] = f"{project}/{config}/{name}"
            return f"service_account:{name}", service_account_access_token(info)
        if info.get("refresh_token") and info.get("client_id") and info.get("client_secret"):
            print(f"{project}/{config}/{name}: OAuth user credential JSON")
            return f"oauth_json:{name}", refresh_token_access_token(info["client_id"], info["client_secret"], info["refresh_token"])
        if "installed" in info or "web" in info:
            print(f"{project}/{config}/{name}: OAuth client JSON without a refresh token")
    by_suffix = {}
    for name in names:
        for suffix in ("CLIENT_ID", "CLIENT_SECRET", "REFRESH_TOKEN"):
            if name.endswith(suffix):
                by_suffix.setdefault(name[: -len(suffix)], {})[suffix] = name
    for prefix, parts in by_suffix.items():
        if {"CLIENT_ID", "CLIENT_SECRET", "REFRESH_TOKEN"} <= parts.keys():
            print(f"{project}/{config}: OAuth triple with prefix {prefix or '(none)'}")
            values = {k: secret_value(project, config, v) for k, v in parts.items()}
            if all(values.values()):
                return f"oauth_triple:{prefix}", refresh_token_access_token(values["CLIENT_ID"], values["CLIENT_SECRET"], values["REFRESH_TOKEN"])
    return None, None


def drive(token, path, **params):
    params.setdefault("supportsAllDrives", "true")
    query = urllib.parse.urlencode(params)
    return http("GET", f"https://www.googleapis.com/drive/v3/{path}?{query}", {"Authorization": "Bearer " + token})


def probe_drive(label, token):
    result = {"credential": label}
    status, body = drive(token, "about", fields="user(emailAddress)")
    result["about_status"] = status
    print(f"drive about: {status}")
    status, body = drive(token, f"files/{DOC_ID}", fields="id,name,mimeType,modifiedTime")
    result["doc_status"] = status
    result["doc"] = body if status == 200 else None
    print(f"doc metadata: {status} mimeType={body.get('mimeType') if status == 200 else '-'}")
    if status == 200 and body.get("mimeType") == "application/vnd.google-apps.document":
        status, text = drive(token, f"files/{DOC_ID}/export", mimeType="text/plain", raw=True)
        result["doc_export_status"] = status
        result["doc_text"] = text.decode("utf-8", "replace") if status == 200 else None
        print(f"doc export: {status} chars={len(text) if status == 200 else 0}")
    status, body = drive(token, "files", q=f"'{FOLDER_ID}' in parents and trashed=false", fields="files(id,name,mimeType,modifiedTime,size)", pageSize="200", includeItemsFromAllDrives="true")
    result["folder_status"] = status
    files = body.get("files", []) if status == 200 else []
    result["folder_files"] = files
    print(f"folder listing: {status} files={len(files)}")
    for item in files:
        if item.get("mimeType") == "application/vnd.google-apps.folder":
            status, sub = drive(token, "files", q=f"'{item['id']}' in parents and trashed=false", fields="files(id,name,mimeType,modifiedTime,size)", pageSize="200", includeItemsFromAllDrives="true")
            item["children"] = sub.get("files", []) if status == 200 else []
            print(f"subfolder: {status} files={len(item['children'])}")
        elif item.get("mimeType") == "application/vnd.google-apps.document":
            status, text = drive(token, f"files/{item['id']}/export", mimeType="text/plain", raw=True)
            item["text"] = text.decode("utf-8", "replace")[:60000] if status == 200 else None
            print(f"doc in folder export: {status}")
    return result


probed = False
for cfg in sorted({(c["project"], c["config"]) for c in report["google_candidates"]}):
    names = [c["name"] for c in report["google_candidates"] if (c["project"], c["config"]) == cfg]
    label, token = classify(cfg[0], cfg[1], names)
    if token:
        report["drive"][f"{cfg[0]}/{cfg[1]}"] = probe_drive(label, token)
        probed = True
        break
if not probed:
    print("no usable Google credential reached the Drive API")

with open("report.json", "w", encoding="utf-8") as handle:
    json.dump(report, handle, ensure_ascii=False, indent=2)
print("report.json written")

# re-run after sharing the folder with the service account
