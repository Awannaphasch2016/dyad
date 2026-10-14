"""Choose GasCity supervisor settings for the formula preview.

Values stay in memory. Callers print present, copied, or absent, never the value.
A loopback or private address is not usable: the formula task is in another VPC.
"""

import ipaddress
import re
from urllib.parse import urlparse

SUPERVISOR_URL = "GAS_CITY_SUPERVISOR_URL"
CITY_NAME = "GAS_CITY_CITY_NAME"
WRITE_GRANT = "GAS_CITY_CITY_WRITE_GRANT"

URL_NAMES = (SUPERVISOR_URL, "GC_SUPERVISOR_URL", "GAS_CITY_URL")
CITY_NAMES = (CITY_NAME, "GC_CITY", "GAS_CITY_CITY", "CITY_NAME")
GRANT_NAMES = (WRITE_GRANT, "GC_CITY_WRITE_GRANT", "X_GC_CITY_WRITE")
NAMES = {
    SUPERVISOR_URL: URL_NAMES,
    CITY_NAME: CITY_NAMES,
    WRITE_GRANT: GRANT_NAMES,
}
REQUIRED = (SUPERVISOR_URL, CITY_NAME)
CITY_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$")
SECRET_FILE = re.compile(r"/tmp/formula-supervisor-[A-Za-z0-9._-]+")


def _text(value):
    if not isinstance(value, str):
        return ""
    if "\n" in value or "\r" in value or "\0" in value:
        return ""
    return value.strip()


def usable_supervisor_url(value):
    text = _text(value)
    if not text or any(char.isspace() for char in text):
        return False
    parsed = urlparse(text)
    if parsed.scheme not in ("http", "https") or parsed.username or parsed.password:
        return False
    host = (parsed.hostname or "").lower().rstrip(".")
    if not host or host in ("localhost", "host.docker.internal"):
        return False
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return True
    return not (
        address.is_loopback
        or address.is_private
        or address.is_link_local
        or address.is_reserved
        or address.is_multicast
        or address.is_unspecified
    )


def usable_city_name(value):
    return CITY_PATTERN.fullmatch(_text(value)) is not None


def usable_write_grant(value):
    text = _text(value)
    return bool(text) and len(text) <= 4096 and not any(char.isspace() for char in text)


def usable(name, value):
    if name == SUPERVISOR_URL:
        return usable_supervisor_url(value)
    if name == CITY_NAME:
        return usable_city_name(value)
    if name == WRITE_GRANT:
        return usable_write_grant(value)
    return False


def _first(names, *sources):
    for source in sources:
        if not isinstance(source, dict):
            continue
        for name in names:
            value = _text(source.get(name))
            if not value:
                continue
            canonical = SUPERVISOR_URL if name in URL_NAMES else CITY_NAME if name in CITY_NAMES else WRITE_GRANT
            if usable(canonical, value):
                return value
    return ""


def choose_supervisor(preview, prd=None, host=None):
    """Prefer a usable preview value, then prd, then the host file."""
    chosen = {}
    for canonical, names in NAMES.items():
        chosen[canonical] = _first(names, preview, prd, host)
    return chosen


def updates_for_preview(preview, chosen):
    updates = {}
    for name, value in chosen.items():
        if not value or usable(name, preview.get(name) if isinstance(preview, dict) else None):
            continue
        updates[name] = value
    return updates


def missing_required(chosen):
    return [name for name in REQUIRED if not chosen.get(name)]


def secret_file_from_log(text):
    found = ""
    for line in text.splitlines():
        if line.startswith("secret_file="):
            found = line.split("=", 1)[1].strip()
    if not SECRET_FILE.fullmatch(found):
        return ""
    return found


def service_targets_supervisor(service):
    parsed = urlparse(_text(service))
    if parsed.scheme not in ("http", "https"):
        return False
    host = (parsed.hostname or "").lower()
    if host not in ("127.0.0.1", "localhost", "::1"):
        return False
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    return port == 8372


def tunnel_url_from_config(text):
    hostname = ""
    for raw in text.splitlines():
        line = raw.strip()
        if line.startswith("#") or ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip().lstrip("-").strip()
        value = value.strip().strip("'").strip('"')
        if key == "hostname":
            hostname = value
            continue
        if key == "service" and hostname and service_targets_supervisor(value):
            url = f"https://{hostname}"
            if usable_supervisor_url(url):
                return url
        if key in ("hostname", "service"):
            hostname = ""
    return ""
