#!/usr/bin/env python3
"""Read formula paths inside containers on running EC2 hosts. Does not print secrets."""

import re
import subprocess
import sys
import tempfile

from list_gascity_running import HOME_REGION, aws_json, describe_regions, time

HOST_PATTERN = re.compile(r"^[A-Za-z0-9.-]+$")
USERS = ("ubuntu", "ec2-user")
REMOTE_READ = """set +e
echo host=$(hostname)
if command -v docker >/dev/null 2>&1; then
  docker ps --format 'docker name={{.Names}} image={{.Image}}'
  for id in $(docker ps -q); do
    docker inspect -f 'inspect name={{.Name}} image={{.Config.Image}} mounts={{range .Mounts}}{{.Destination}}@{{.Source}};{{end}}' "$id"
    docker exec "$id" sh -c 'echo paths; ls -d /opt/gascity /opt/gascity/city /opt/gascity/city/formulas /usr/local/bin/gc /usr/bin/gc 2>/dev/null; find /opt/gascity /home/weaver /city \\( -name discovery.toml -o -name implementation.toml -o -name delivery.toml -o -name gc \\) 2>/dev/null | head -80'
  done
else
  echo docker absent
fi
if [ -d /opt/gascity/city/formulas ]; then
  echo host_formulas
  find /opt/gascity/city/formulas -name '*.toml' | head -20
fi
ps -eo args | awk '/gc supervisor/ && !/awk/ {print}'
"""


def safe_line(line):
    if re.search(
        r"(AKIA|dp\.|postgres://|Bearer |BEGIN |PASSWORD=|SECRET=|TOKEN=)",
        line,
        re.IGNORECASE,
    ):
        return "redacted"
    return line[:300]


def ssh_command(key_path, user, host, known_hosts):
    if not HOST_PATTERN.fullmatch(host):
        raise ValueError("host is not a hostname")
    if user not in USERS:
        raise ValueError("user is not allowed")
    return [
        "ssh",
        "-i",
        key_path,
        "-o",
        "IdentitiesOnly=yes",
        "-o",
        "ConnectTimeout=12",
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-o",
        f"UserKnownHostsFile={known_hosts}",
        f"{user}@{host}",
        REMOTE_READ,
    ]


def public_ips(payload):
    ips = []
    for reservation in payload.get("Reservations") or []:
        for instance in reservation.get("Instances") or []:
            state = (instance.get("State") or {}).get("Name", "")
            address = instance.get("PublicIpAddress") or ""
            if state == "running" and HOST_PATTERN.fullmatch(address):
                ips.append(address)
    return ips


def probe_host(key_path, host, known_hosts, run):
    for user in USERS:
        proc = run(ssh_command(key_path, user, host, known_hosts))
        if proc.returncode == 0:
            print(f"ssh user={user} host={host} ok")
            for line in (proc.stdout or "").splitlines():
                print(safe_line(line))
            return
        print(f"ssh user={user} host={host} unreachable")
    return


def main():
    if len(sys.argv) != 2:
        sys.stderr.write("usage: read_host_containers.py KEY\n")
        return 2
    key_path = sys.argv[1]
    listed = describe_regions(
        lambda: aws_json(["ec2", "describe-regions"], HOME_REGION),
        time.sleep,
    )
    if listed.get("denied"):
        print("describe-regions denied")
        return 0
    with tempfile.TemporaryDirectory(prefix="formula-host-") as work:
        known_hosts = f"{work}/known_hosts"

        def run(command):
            return subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=40,
                check=False,
            )

        for region_item in listed.get("Regions") or []:
            region = region_item.get("RegionName") or ""
            if not region:
                continue
            instances = aws_json(["ec2", "describe-instances"], region)
            if instances.get("denied"):
                print(f"region={region} ec2 denied")
                continue
            for host in public_ips(instances):
                try:
                    probe_host(key_path, host, known_hosts, run)
                except subprocess.TimeoutExpired:
                    print(f"ssh host={host} timeout")
    return 0


if __name__ == "__main__":
    sys.exit(main())
