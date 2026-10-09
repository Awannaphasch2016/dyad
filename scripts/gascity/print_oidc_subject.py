#!/usr/bin/env python3
"""Print the GitHub OIDC subject and audience. Does not print the token."""

import base64
import json
import sys


def subject_lines(token_response_text):
    payload = json.loads(token_response_text)
    token = str(payload.get("value") or "")
    parts = token.split(".")
    if len(parts) < 2 or not parts[1]:
        raise SystemExit("oidc token was not returned")
    part = parts[1]
    part += "=" * ((4 - len(part) % 4) % 4)
    claims = json.loads(base64.urlsafe_b64decode(part))
    sub = str(claims.get("sub") or "")
    aud = claims.get("aud") or ""
    if isinstance(aud, list):
        aud = ",".join(str(item) for item in aud)
    else:
        aud = str(aud)
    if not sub:
        raise SystemExit("oidc sub was empty")
    return f"oidc sub={sub}\noidc aud={aud}\n"


def main():
    sys.stdout.write(subject_lines(sys.stdin.read()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
