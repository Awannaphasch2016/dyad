"""Describe a checked-out copy of the GIT Conference repository.

Writes report.json with: git summary, directory tree, extension histogram,
largest files, cloc with and without the exclusions from the plan (B.3),
heads of a few descriptive files, configuration key names, route-looking
strings, and markers that tie the code to the live site. Lines that look like
credentials are masked before they enter the report. The log gets counts only.
"""

import collections
import json
import os
import re
import subprocess
import sys

root = sys.argv[1]
out_path = sys.argv[2]
SECRET_LINE = re.compile(r"(pass(word)?|secret|token|api[_-]?key|private[_-]?key|dsn|dbpass|db_pass)", re.I)
EXCLUDE_DIRS = {"vendor", "node_modules", "storage", "cache", "uploads", "upload", "logs", "log", "dist", "build", ".git", "tmp", "temp"}
report = {"repo": os.environ.get("GITCON_REPO"), "ref": os.environ.get("GITCON_REF")}


def run(cmd, cwd=root, check=False):
    try:
        proc = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, errors="replace")
    except FileNotFoundError:
        print(f"{cmd[0]} is not installed")
        return ""
    if check and proc.returncode != 0:
        raise RuntimeError(f"{cmd}: {proc.stderr}")
    return proc.stdout


def masked(text, limit=4000):
    lines = []
    for line in text.splitlines()[:120]:
        if SECRET_LINE.search(line) and ("=" in line or ":" in line or "=>" in line):
            key = re.split(r"=>|=|:", line, maxsplit=1)[0]
            lines.append(key.rstrip() + " = <masked>")
        else:
            lines.append(line)
    return "\n".join(lines)[:limit]


# Git summary
report["git"] = {
    "head": run(["git", "rev-parse", "HEAD"]).strip(),
    "commits": int(run(["git", "rev-list", "--count", "HEAD"]).strip() or 0),
    "first_commit": run(["git", "log", "--reverse", "--format=%ad", "--date=short"]).splitlines()[:1],
    "last_commit": run(["git", "log", "-1", "--format=%ad", "--date=short"]).strip(),
    "authors": len(set(run(["git", "log", "--format=%ae"]).splitlines())),
    "branches": run(["git", "branch", "-r", "--format=%(refname:short)"]).splitlines()[:40],
    "tags": run(["git", "tag"]).splitlines()[:40],
}
print(f"git: {report['git']['commits']} commits, {report['git']['authors']} authors")

# Tree and histogram
tree = []
hist = collections.Counter()
sizes = []
for dirpath, dirnames, filenames in os.walk(root):
    rel = os.path.relpath(dirpath, root)
    depth = 0 if rel == "." else rel.count(os.sep) + 1
    dirnames[:] = sorted(d for d in dirnames if d != ".git")
    if depth <= 3:
        tree.append({"dir": rel, "dirs": dirnames[:60], "files": len(filenames), "sample_files": sorted(filenames)[:25]})
    for name in filenames:
        path = os.path.join(dirpath, name)
        ext = os.path.splitext(name)[1].lower() or "(none)"
        hist[ext] += 1
        try:
            sizes.append((os.path.getsize(path), os.path.relpath(path, root)))
        except OSError:
            pass
report["tree"] = tree
report["extensions"] = hist.most_common(40)
report["largest_files"] = [{"bytes": b, "path": p} for b, p in sorted(sizes, reverse=True)[:40]]
report["total_files"] = sum(hist.values())
print(f"files: {report['total_files']}, top extensions: {hist.most_common(6)}")

# cloc, raw and with the plan's exclusions
raw = run(["cloc", "--vcs=git", "--json", "--quiet", "."])
report["cloc_raw"] = json.loads(raw) if raw.strip() else None
excluded = run([
    "cloc", "--vcs=git", "--json", "--quiet",
    "--exclude-dir=" + ",".join(sorted(EXCLUDE_DIRS)),
    "--not-match-d=assets/(vendor|lib|plugins)",
    r"--not-match-f=(\.min\.(js|css)|composer\.lock|package-lock\.json|yarn\.lock)$",
    "--exclude-lang=JSON,YAML,Markdown,Text,SVG,XML",
    ".",
])
report["cloc_excluded"] = json.loads(excluded) if excluded.strip() else None
if report["cloc_excluded"]:
    php = report["cloc_excluded"].get("PHP", {}).get("code")
    total = report["cloc_excluded"].get("SUM", {}).get("code")
    print(f"cloc after exclusions: total code lines {total}, PHP {php}")
by_dir = {}
for entry in tree:
    if entry["dir"] != "." and entry["dir"].count(os.sep) == 0 and entry["dir"] not in EXCLUDE_DIRS:
        sub = run(["cloc", "--json", "--quiet", "--exclude-dir=" + ",".join(sorted(EXCLUDE_DIRS)), entry["dir"]])
        if sub.strip():
            by_dir[entry["dir"]] = json.loads(sub).get("SUM", {}).get("code")
report["cloc_by_top_dir"] = by_dir

# Descriptive files
heads = {}
for name in ["README.md", "readme.md", "README.txt", "composer.json", "package.json", "Dockerfile", "docker-compose.yml", ".htaccess", "index.php", ".env.example", "config.php", "install.txt"]:
    path = os.path.join(root, name)
    if os.path.isfile(path):
        with open(path, encoding="utf-8", errors="replace") as handle:
            heads[name] = masked(handle.read())
report["file_heads"] = heads
print(f"descriptive files found: {sorted(heads)}")

# Configuration key names and markers
config_keys = {}
markers = collections.Counter()
routes = set()
sql_files = []
for dirpath, dirnames, filenames in os.walk(root):
    dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
    for name in filenames:
        path = os.path.join(dirpath, name)
        rel = os.path.relpath(path, root)
        lower = name.lower()
        if lower.endswith(".sql"):
            sql_files.append({"path": rel, "bytes": os.path.getsize(path)})
        if not lower.endswith((".php", ".ini", ".env", ".json", ".js", ".htaccess", ".html", ".tpl")):
            continue
        if os.path.getsize(path) > 2_000_000:
            continue
        with open(path, encoding="utf-8", errors="replace") as handle:
            text = handle.read()
        for marker in ("gitconference", "wewebserver", "wewebplus", "dev25-git-con", "mode=debug", "recaptcha", "google", "PHPSESSID", "mysqli", "PDO", "mysql_", "pg_connect", "sqlite"):
            if marker.lower() in text.lower():
                markers[marker] += 1
        if "config" in rel.lower() or lower in {".env", "settings.php", "database.php", "db.php"}:
            keys = re.findall(r"define\(\s*['\"]([A-Z0-9_]+)['\"]|\$([A-Za-z_][A-Za-z0-9_]*)\s*=|^([A-Z0-9_]+)\s*=", text, re.M)
            config_keys[rel] = sorted({k for group in keys for k in group if k})[:60]
        for route in re.findall(r"['\"](/?(?:en|th)/[a-z0-9_/-]{2,40})['\"]", text):
            routes.add(route)
report["config_key_names"] = config_keys
report["markers"] = dict(markers)
report["route_like_strings"] = sorted(routes)[:200]
report["sql_files"] = sql_files
print(f"markers: {dict(markers)}; sql files: {len(sql_files)}; route-like strings: {len(routes)}")

with open(out_path, "w", encoding="utf-8") as handle:
    json.dump(report, handle, ensure_ascii=False, indent=2, default=str)
print("report.json written")
