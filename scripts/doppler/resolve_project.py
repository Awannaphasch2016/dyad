"""Look up a Google Cloud project's display name with the Drive service account.

The service-account JSON is /tmp/sa.json. PROJECT_ID or PROJECT_NUMBER selects
the project. Prints the display name, project id, and project number.
"""

import base64
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request


def b64(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def main():
    info = json.loads(open("/tmp/sa.json").read())
    os.unlink("/tmp/sa.json")
    now = int(time.time())
    header = b64(json.dumps({"alg": "RS256", "typ": "JWT"}).encode())
    claims = b64(
        json.dumps(
            {
                "iss": info["client_email"],
                "scope": "https://www.googleapis.com/auth/cloud-platform.read-only",
                "aud": "https://oauth2.googleapis.com/token",
                "iat": now,
                "exp": now + 600,
            }
        ).encode()
    )
    signing = f"{header}.{claims}".encode()
    with tempfile.NamedTemporaryFile("w", delete=False) as key_file:
        key_file.write(info["private_key"])
        path = key_file.name
    try:
        sig = subprocess.run(
            ["openssl", "dgst", "-sha256", "-sign", path],
            input=signing,
            capture_output=True,
            check=True,
        ).stdout
    finally:
        os.unlink(path)
    assertion = f"{header}.{claims}.{b64(sig)}"
    body = urllib.parse.urlencode(
        {
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
            "assertion": assertion,
        }
    ).encode()
    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=body)
    with urllib.request.urlopen(req, timeout=30) as resp:
        access = json.load(resp)["access_token"]
    print("::add-mask::" + access)
    ref = os.environ.get("PROJECT_ID") or os.environ.get("PROJECT_NUMBER")
    url = "https://cloudresourcemanager.googleapis.com/v1/projects/" + urllib.parse.quote(
        ref
    )
    get = urllib.request.Request(url, headers={"Authorization": "Bearer " + access})
    try:
        with urllib.request.urlopen(get, timeout=30) as resp:
            project = json.load(resp)
    except urllib.error.HTTPError as err:
        print(f"resource manager status {err.code} for {ref}")
        return
    print("project_name=" + project.get("name", ""))
    print("project_id=" + project.get("projectId", ""))
    print("project_number=" + project.get("projectNumber", ""))


if __name__ == "__main__":
    main()
