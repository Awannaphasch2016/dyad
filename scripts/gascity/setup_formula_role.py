#!/usr/bin/env python3
"""Create the formula preview role from the production host and store its ARN in Doppler.

Uses DOPPLER_TOKEN when the workflow forwarded one (it can read both configs),
and otherwise the token files on this machine. Does not print token values, AWS keys, or the role ARN.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import zipfile

ROLE_NAME = "github-preview-formula"
TRUST_SUB = "repo:Awannaphasch2016/dyad:ref:refs/heads/cursor/formula-config-ui-55d6"
DYAD_TOKEN_FILE = "/etc/doppler/dyad-preview.token"
AWS_TOKEN_FILE = "/etc/doppler/aws-dev.token"
SECRET_NAME = "AWS_PREVIEW_FORMULA_ROLE_ARN"
OIDC_URL = "https://token.actions.githubusercontent.com"
OIDC_HOST = "token.actions.githubusercontent.com"


def trust_policy(account_id):
    return {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Principal": {
                    "Federated": f"arn:aws:iam::{account_id}:oidc-provider/{OIDC_HOST}"
                },
                "Action": "sts:AssumeRoleWithWebIdentity",
                "Condition": {
                    "StringEquals": {
                        f"{OIDC_HOST}:aud": "sts.amazonaws.com",
                        f"{OIDC_HOST}:sub": TRUST_SUB,
                    }
                },
            }
        ],
    }


def permissions_policy(account_id):
    task_roles = [
        f"arn:aws:iam::{account_id}:role/formula-preview-execution",
        f"arn:aws:iam::{account_id}:role/formula-preview-task",
    ]
    return {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "PreviewNetwork",
                "Effect": "Allow",
                "Action": [
                    "ec2:DescribeAvailabilityZones",
                    "ec2:DescribeVpcs",
                    "ec2:DescribeSubnets",
                    "ec2:DescribeInternetGateways",
                    "ec2:DescribeRouteTables",
                    "ec2:DescribeSecurityGroups",
                    "ec2:CreateVpc",
                    "ec2:CreateSubnet",
                    "ec2:CreateInternetGateway",
                    "ec2:CreateRouteTable",
                    "ec2:CreateRoute",
                    "ec2:CreateSecurityGroup",
                    "ec2:CreateTags",
                    "ec2:ModifyVpcAttribute",
                    "ec2:ModifySubnetAttribute",
                    "ec2:AttachInternetGateway",
                    "ec2:AssociateRouteTable",
                    "ec2:AuthorizeSecurityGroupIngress",
                    "ec2:RevokeSecurityGroupIngress",
                ],
                "Resource": "*",
            },
            {
                "Sid": "PreviewLoadBalancer",
                "Effect": "Allow",
                "Action": [
                    "elasticloadbalancing:DescribeLoadBalancers",
                    "elasticloadbalancing:DescribeTargetGroups",
                    "elasticloadbalancing:DescribeListeners",
                    "elasticloadbalancing:DescribeLoadBalancerAttributes",
                    "elasticloadbalancing:CreateLoadBalancer",
                    "elasticloadbalancing:CreateTargetGroup",
                    "elasticloadbalancing:CreateListener",
                    "elasticloadbalancing:ModifyLoadBalancerAttributes",
                    "elasticloadbalancing:ModifyTargetGroup",
                ],
                "Resource": "*",
            },
            {
                "Sid": "PreviewEcs",
                "Effect": "Allow",
                "Action": [
                    "ecs:DescribeClusters",
                    "ecs:CreateCluster",
                    "ecs:DescribeServices",
                    "ecs:CreateService",
                    "ecs:UpdateService",
                    "ecs:RegisterTaskDefinition",
                    "ecs:DescribeTaskDefinition",
                ],
                "Resource": "*",
            },
            {
                "Sid": "PreviewLogs",
                "Effect": "Allow",
                "Action": ["logs:DescribeLogGroups", "logs:CreateLogGroup"],
                "Resource": "*",
            },
            {
                "Sid": "PreviewEcrAuth",
                "Effect": "Allow",
                "Action": [
                    "ecr:GetAuthorizationToken",
                    "ecr:DescribeRepositories",
                    "ecr:CreateRepository",
                ],
                "Resource": "*",
            },
            {
                "Sid": "PreviewEcr",
                "Effect": "Allow",
                "Action": [
                    "ecr:DescribeImages",
                    "ecr:BatchCheckLayerAvailability",
                    "ecr:InitiateLayerUpload",
                    "ecr:UploadLayerPart",
                    "ecr:CompleteLayerUpload",
                    "ecr:PutImage",
                    "ecr:BatchGetImage",
                    "ecr:GetDownloadUrlForLayer",
                ],
                "Resource": f"arn:aws:ecr:ap-southeast-1:{account_id}:repository/dyad-formula-preview",
            },
            {
                "Sid": "PreviewSecrets",
                "Effect": "Allow",
                "Action": [
                    "secretsmanager:DescribeSecret",
                    "secretsmanager:GetSecretValue",
                    "secretsmanager:CreateSecret",
                    "secretsmanager:PutSecretValue",
                ],
                "Resource": f"arn:aws:secretsmanager:ap-southeast-1:{account_id}:secret:wewebplus/formula-preview*",
            },
            {
                "Sid": "PreviewTaskRoles",
                "Effect": "Allow",
                "Action": [
                    "iam:GetRole",
                    "iam:CreateRole",
                    "iam:AttachRolePolicy",
                    "iam:PutRolePolicy",
                    "iam:PassRole",
                ],
                "Resource": task_roles,
            },
        ],
    }


def redact(text):
    text = re.sub(r"dp\.[a-z]{2}\.[A-Za-z0-9]+", "dp.redacted", text)
    text = re.sub(r"AKIA[0-9A-Z]{16}", "AKIA...", text)
    text = re.sub(
        r"arn:aws:iam::[0-9]{12}:role/[A-Za-z0-9+=,.@_-]+",
        "arn:aws:iam::redacted:role/redacted",
        text,
    )
    return text[-800:]


def read_root_file(path):
    if os.path.isfile(path) and os.access(path, os.R_OK):
        with open(path, encoding="utf-8") as handle:
            return handle.read().strip()
    proc = subprocess.run(
        ["sudo", "-n", "cat", path],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        detail = redact(proc.stderr.strip()) or "sudo refused"
        raise SystemExit(f"cannot read {path}: {detail}")
    return proc.stdout.strip()


def doppler_json(token, url, payload=None):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
        method="GET" if payload is None else "POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read()
            return response.status, json.loads(body.decode("utf-8")) if body else {}
    except urllib.error.HTTPError as error:
        error.read()
        return error.code, {}


def credential_source():
    """Where the Doppler credential comes from.

    A forwarded token is a service-account token, so the project and config
    are named explicitly. A file token is bound to one config and the API
    reports which one.
    """
    forwarded = os.environ.get("DOPPLER_TOKEN", "").strip()
    if forwarded:
        return "env", forwarded, "dyad", "preview", "aws", "dev"
    return "file", "", "", "", "", ""


def config_query(project, config):
    if not project or not config:
        return ""
    return f"&project={urllib.parse.quote(project)}&config={urllib.parse.quote(config)}"


def doppler_config(token, project="", config=""):
    status, body = doppler_json(
        token,
        "https://api.doppler.com/v3/configs/config?" + config_query(project, config).lstrip("&"),
    )
    config = body.get("config") if isinstance(body, dict) else None
    if status != 200 or not isinstance(config, dict):
        return status, "", ""
    return status, str(config.get("project") or ""), str(config.get("name") or "")


def doppler_download(token, project="", config=""):
    status, body = doppler_json(
        token,
        "https://api.doppler.com/v3/configs/config/secrets/download?format=json"
        + config_query(project, config),
    )
    if status != 200 or not isinstance(body, dict):
        raise SystemExit(f"doppler download failed ({status})")
    return body


def store_role_arn(token, role_arn, project, config):
    payload = {"secrets": {SECRET_NAME: role_arn}}
    if project and config:
        payload["project"] = project
        payload["config"] = config
    status, _body = doppler_json(
        token,
        "https://api.doppler.com/v3/configs/config/secrets",
        payload,
    )
    return status


def ensure_aws_cli(work):
    found = shutil.which("aws")
    if found:
        return found
    archive = os.path.join(work, "awscli.zip")
    urllib.request.urlretrieve(
        "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip",
        archive,
    )
    with zipfile.ZipFile(archive) as packed:
        packed.extractall(work)
    install = os.path.join(work, "aws", "install")
    target = os.path.join(work, "aws-cli")
    bindir = os.path.join(work, "bin")
    subprocess.run(
        [install, "-i", target, "-b", bindir],
        check=True,
        stdout=subprocess.DEVNULL,
    )
    return os.path.join(bindir, "aws")


def run_aws(aws, env, args):
    proc = subprocess.run(
        [aws, "--output", "json", *args],
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )
    if proc.returncode != 0:
        raise SystemExit(f"aws {' '.join(args[:2])} failed: {redact(proc.stderr.strip())}")
    if not proc.stdout.strip():
        return {}
    return json.loads(proc.stdout)


def ensure_oidc_provider(aws, env, account_id):
    listed = run_aws(aws, env, ["iam", "list-open-id-connect-providers"])
    for provider in listed.get("OpenIDConnectProviderList", []):
        arn = provider.get("Arn", "")
        if arn.endswith(f"/{OIDC_HOST}"):
            return arn
    created = run_aws(
        aws,
        env,
        [
            "iam",
            "create-open-id-connect-provider",
            "--url",
            OIDC_URL,
            "--client-id-list",
            "sts.amazonaws.com",
            "--thumbprint-list",
            "6938fd4d98bab03faadb97b34396831e3780aea1",
        ],
    )
    return created.get("OpenIDConnectProviderArn") or (
        f"arn:aws:iam::{account_id}:oidc-provider/{OIDC_HOST}"
    )


def ensure_role(aws, env, account_id):
    trust = trust_policy(account_id)
    policy = permissions_policy(account_id)
    trust_file = os.path.join(tempfile.gettempdir(), "formula-role-trust.json")
    policy_file = os.path.join(tempfile.gettempdir(), "formula-role-policy.json")
    for path, document in ((trust_file, trust), (policy_file, policy)):
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(document, handle)
        os.chmod(path, 0o600)
    exists = subprocess.run(
        [aws, "iam", "get-role", "--role-name", ROLE_NAME],
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )
    if exists.returncode != 0:
        run_aws(
            aws,
            env,
            [
                "iam",
                "create-role",
                "--role-name",
                ROLE_NAME,
                "--assume-role-policy-document",
                f"file://{trust_file}",
            ],
        )
    else:
        run_aws(
            aws,
            env,
            [
                "iam",
                "update-assume-role-policy",
                "--role-name",
                ROLE_NAME,
                "--policy-document",
                f"file://{trust_file}",
            ],
        )
    run_aws(
        aws,
        env,
        [
            "iam",
            "put-role-policy",
            "--role-name",
            ROLE_NAME,
            "--policy-name",
            "formula-preview",
            "--policy-document",
            f"file://{policy_file}",
        ],
    )
    described = run_aws(aws, env, ["iam", "get-role", "--role-name", ROLE_NAME])
    role_arn = described.get("Role", {}).get("Arn", "")
    if not re.fullmatch(r"arn:aws:iam::[0-9]{12}:role/[A-Za-z0-9+=,.@_-]+", role_arn):
        raise SystemExit("role arn was not created")
    for path in (trust_file, policy_file):
        os.remove(path)
    return role_arn


def main():
    print("setup-formula-role start", flush=True)
    source, forwarded, dyad_project, dyad_config, aws_project, aws_config = credential_source()
    print(f"doppler_source={source}")
    if source == "env":
        dyad_token = aws_token = forwarded
        dyad_status, project, config = doppler_config(dyad_token, dyad_project, dyad_config)
        aws_env = doppler_download(aws_token, aws_project, aws_config)
    else:
        dyad_token = read_root_file(DYAD_TOKEN_FILE)
        aws_token = read_root_file(AWS_TOKEN_FILE)
        dyad_status, project, config = doppler_config(dyad_token)
        aws_env = doppler_download(aws_token)
    print(f"dyad token http {dyad_status} project={project or 'unknown'} config={config or 'unknown'}")
    if source == "env" and dyad_status != 200:
        raise SystemExit(f"forwarded token cannot read dyad/preview ({dyad_status})")
    for name in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION"):
        if not aws_env.get(name):
            raise SystemExit(f"aws doppler config is missing {name}")
    work = tempfile.mkdtemp(prefix="formula-role-")
    try:
        aws = ensure_aws_cli(work)
        env = os.environ.copy()
        env.update(
            {
                "AWS_ACCESS_KEY_ID": aws_env["AWS_ACCESS_KEY_ID"],
                "AWS_SECRET_ACCESS_KEY": aws_env["AWS_SECRET_ACCESS_KEY"],
                "AWS_REGION": aws_env.get("AWS_REGION") or "ap-southeast-1",
                "AWS_DEFAULT_REGION": aws_env.get("AWS_REGION") or "ap-southeast-1",
            }
        )
        identity = run_aws(aws, env, ["sts", "get-caller-identity"])
        account_id = identity.get("Account", "")
        if not re.fullmatch(r"[0-9]{12}", account_id):
            raise SystemExit("aws account id was not available")
        print(f"aws account {account_id}")
        ensure_oidc_provider(aws, env, account_id)
        role_arn = ensure_role(aws, env, account_id)
        status = store_role_arn(dyad_token, role_arn, project, config)
        print(f"doppler {SECRET_NAME} http {status} project={project or 'unknown'} config={config or 'unknown'}")
        print(f"doppler_write=http-{status} project={project or 'unknown'} config={config or 'unknown'}")
        if status not in (200, 201):
            raise SystemExit(f"doppler write failed ({status})")
        print(f"{SECRET_NAME}=stored")
        print("setup-formula-role done")
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as error:
        print(redact(str(error)), file=sys.stderr)
        sys.exit(1)
