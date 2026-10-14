#!/usr/bin/env python3
"""Describe running ECS containers. Prints paths and names, never secret values."""

import os
import re
import sys

from list_gascity_running import (
    HOME_REGION,
    aws_json,
    cluster_name,
    denial_label,
    describe_regions,
    time,
)

NAME_PATTERN = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


def env_marks(environment):
    marks = []
    for item in environment or []:
        name = str(item.get("name") or "")
        if not NAME_PATTERN.fullmatch(name):
            continue
        value = item.get("value")
        state = "set" if isinstance(value, str) and value.strip() else "empty"
        marks.append(f"{name}={state}")
    return marks


def secret_names(secrets):
    names = []
    for item in secrets or []:
        name = str(item.get("name") or "")
        if NAME_PATTERN.fullmatch(name):
            names.append(name)
    return names


def public_image(image):
    text = str(image or "-")
    if "://" in text and "@" in text.split("://", 1)[1]:
        return "redacted-image"
    return text


def task_id(task):
    arn = str(task.get("taskArn") or "")
    return arn.rsplit("/", 1)[-1] if arn else "-"


def task_lines(region, cluster, task, definition):
    defined = {
        item.get("name"): item
        for item in (definition or {}).get("containerDefinitions") or []
        if item.get("name")
    }
    launch = task.get("launchType") or "-"
    execute = "yes" if task.get("enableExecuteCommand") else "no"
    lines = [
        " ".join(
            [
                f"region={region}",
                f"cluster={cluster}",
                f"task={task_id(task)}",
                f"launch={launch}",
                f"exec={execute}",
                f"status={task.get('lastStatus') or '-'}",
            ]
        )
    ]
    for volume in (definition or {}).get("volumes") or []:
        host = (volume.get("host") or {}).get("sourcePath") or "-"
        efs = (volume.get("efsVolumeConfiguration") or {}).get("fileSystemId") or "-"
        lines.append(f"volume name={volume.get('name') or '-'} host={host} efs={efs}")
    runtime_containers = task.get("containers") or []
    if not runtime_containers:
        runtime_containers = [
            {"name": name, "image": item.get("image")}
            for name, item in defined.items()
        ]
    for runtime in runtime_containers:
        name = runtime.get("name") or "-"
        spec = defined.get(name) or {}
        image = public_image(runtime.get("image") or spec.get("image"))
        entry = " ".join(spec.get("entryPoint") or []) or "-"
        command = " ".join(spec.get("command") or []) or "-"
        lines.append(
            f"container={name} image={image} entry={entry} command={command}"
        )
        for mount in spec.get("mountPoints") or []:
            lines.append(
                " ".join(
                    [
                        f"mount container={name}",
                        f"path={mount.get('containerPath') or '-'}",
                        f"source={mount.get('sourceVolume') or '-'}",
                    ]
                )
            )
        marks = env_marks(spec.get("environment"))
        if marks:
            lines.append(f"env container={name} " + " ".join(marks))
        names = secret_names(spec.get("secrets"))
        if names:
            lines.append(f"secrets container={name} " + " ".join(names))
    return lines


def remember_image(images, image):
    text = public_image(image)
    if text and text != "-" and text != "redacted-image":
        images.add(text)


def main():
    listed = describe_regions(
        lambda: aws_json(["ec2", "describe-regions"], HOME_REGION),
        time.sleep,
    )
    if listed.get("denied"):
        print(f"describe-regions denied {denial_label(listed['denied'])}")
        return 1
    images = set()
    for region_item in listed.get("Regions") or []:
        region = region_item.get("RegionName") or ""
        if not region:
            continue
        clusters = aws_json(["ecs", "list-clusters"], region)
        if clusters.get("denied"):
            print(f"region={region} ecs denied")
            continue
        for cluster_arn in clusters.get("clusterArns") or []:
            cluster = cluster_name(cluster_arn)
            tasks = aws_json(
                [
                    "ecs",
                    "list-tasks",
                    "--cluster",
                    cluster_arn,
                    "--desired-status",
                    "RUNNING",
                ],
                region,
            )
            if tasks.get("denied"):
                print(f"region={region} cluster={cluster} tasks denied")
                continue
            arns = tasks.get("taskArns") or []
            if not arns:
                print(f"region={region} cluster={cluster} tasks=0")
                continue
            definitions = {}
            for start in range(0, len(arns), 10):
                described = aws_json(
                    [
                        "ecs",
                        "describe-tasks",
                        "--cluster",
                        cluster_arn,
                        "--tasks",
                        *arns[start : start + 10],
                    ],
                    region,
                )
                if described.get("denied"):
                    print(f"region={region} cluster={cluster} tasks denied")
                    break
                for task in described.get("tasks") or []:
                    definition_arn = task.get("taskDefinitionArn") or ""
                    if definition_arn and definition_arn not in definitions:
                        loaded = aws_json(
                            [
                                "ecs",
                                "describe-task-definition",
                                "--task-definition",
                                definition_arn,
                            ],
                            region,
                        )
                        if loaded.get("denied"):
                            print(
                                f"region={region} cluster={cluster} task-definition denied"
                            )
                            definitions[definition_arn] = {}
                        else:
                            definitions[definition_arn] = loaded.get("taskDefinition") or {}
                    definition = definitions.get(definition_arn) or {}
                    for line in task_lines(region, cluster, task, definition):
                        print(line)
                    for runtime in task.get("containers") or []:
                        remember_image(images, runtime.get("image"))
    image_list = os.environ.get("CONTAINER_IMAGE_LIST", "").strip()
    if image_list:
        with open(image_list, "w", encoding="utf-8") as handle:
            for image in sorted(images):
                handle.write(image + "\n")
        print(f"images={len(images)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
