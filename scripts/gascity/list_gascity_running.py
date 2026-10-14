#!/usr/bin/env python3
"""Print running machines across AWS regions. Does not print secret values."""

import json
import re
import subprocess
import sys
import time

HOME_REGION = "ap-southeast-1"
RETRY_WAITS = (15, 15, 15, 15, 15, 15)


def aws_json(args, region):
    proc = subprocess.run(
        ["aws", "--region", region, "--output", "json", *args],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "aws failed").strip().splitlines()
        message = detail[-1] if detail else "aws failed"
        if "AccessDenied" in message or "UnauthorizedOperation" in message:
            return {"denied": message[:180]}
        raise SystemExit(message[:180])
    if not proc.stdout.strip():
        return {}
    return json.loads(proc.stdout)


def denial_label(message):
    kind = "explicit-deny" if "explicit deny" in message.lower() else "not-allowed"
    match = re.search(r"\(([A-Za-z]+)\)", message)
    code = match.group(1) if match else "unknown"
    return f"kind={kind} code={code}"


def describe_regions(invoke, wait):
    payload = invoke()
    if not payload.get("denied"):
        return payload
    print(f"describe-regions waiting {denial_label(payload['denied'])}", flush=True)
    for delay in RETRY_WAITS:
        wait(delay)
        payload = invoke()
        if not payload.get("denied"):
            return payload
        print(f"describe-regions waiting {denial_label(payload['denied'])}", flush=True)
    return payload


def regions(payload):
    names = []
    for item in payload.get("Regions", []):
        name = item.get("RegionName", "")
        if name:
            names.append(name)
    return sorted(names)


def name_tag(tags):
    for tag in tags or []:
        if tag.get("Key") == "Name" and tag.get("Value"):
            return str(tag["Value"])
    return "-"


def ec2_lines(region, payload):
    lines = []
    for reservation in payload.get("Reservations", []):
        for instance in reservation.get("Instances", []):
            state = (instance.get("State") or {}).get("Name", "unknown")
            if state not in ("pending", "running"):
                continue
            lines.append(
                " ".join(
                    [
                        f"region={region}",
                        "ec2",
                        instance.get("InstanceId", "-"),
                        f"name={name_tag(instance.get('Tags'))}",
                        f"state={state}",
                        f"public={instance.get('PublicIpAddress') or '-'}",
                        f"private={instance.get('PrivateIpAddress') or '-'}",
                    ]
                )
            )
    return lines


def cluster_name(arn):
    marker = ":cluster/"
    if marker in arn:
        return arn.split(marker, 1)[1]
    return arn


def ecs_lines(region, clusters):
    lines = []
    for cluster in clusters:
        name = cluster_name(cluster.get("clusterArn", ""))
        for service in cluster.get("services", []):
            lines.append(
                " ".join(
                    [
                        f"region={region}",
                        "ecs",
                        f"cluster={name}",
                        f"service={service.get('serviceName', '-')}",
                        f"desired={service.get('desiredCount', 0)}",
                        f"running={service.get('runningCount', 0)}",
                        f"status={service.get('status', '-')}",
                    ]
                )
            )
    return lines


def main():
    listed = describe_regions(
        lambda: aws_json(["ec2", "describe-regions"], HOME_REGION),
        time.sleep,
    )
    if listed.get("denied"):
        print(f"describe-regions denied {denial_label(listed['denied'])}")
        return 1
    found_regions = regions(listed)
    ec2_count = 0
    ecs_count = 0
    for region in found_regions:
        instances = aws_json(["ec2", "describe-instances"], region)
        if instances.get("denied"):
            print(f"region={region} ec2 denied")
            continue
        ec2 = ec2_lines(region, instances)
        ec2_count += len(ec2)
        for line in ec2:
            print(line)
        cluster_page = aws_json(["ecs", "list-clusters"], region)
        if cluster_page.get("denied"):
            print(f"region={region} ecs denied")
            continue
        for arn in cluster_page.get("clusterArns", []):
            service_page = aws_json(
                ["ecs", "list-services", "--cluster", arn],
                region,
            )
            if service_page.get("denied"):
                print(f"region={region} ecs cluster={cluster_name(arn)} denied")
                continue
            arns = service_page.get("serviceArns", [])
            services = []
            denied = False
            for start in range(0, len(arns), 10):
                described = aws_json(
                    [
                        "ecs",
                        "describe-services",
                        "--cluster",
                        arn,
                        "--services",
                        *arns[start : start + 10],
                    ],
                    region,
                )
                if described.get("denied"):
                    print(f"region={region} ecs cluster={cluster_name(arn)} denied")
                    denied = True
                    break
                services.extend(described.get("services", []))
            if denied:
                continue
            block = ecs_lines(region, [{"clusterArn": arn, "services": services}])
            ecs_count += len(block)
            for line in block:
                print(line)
    print(f"regions={len(found_regions)} running_ec2={ec2_count} ecs_services={ecs_count}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
