#!/usr/bin/env bash
# Register the canary ECS service. Refuses the production database, a public
# bridge, and any instance other than the canary capacity host.
set -euo pipefail

region=ap-southeast-1
cluster=wewebplus
instance=i-023d741ed3a1b3b25
security_group=sg-0d19518d244fede2d
export AWS_DEFAULT_REGION="$region"
cd "$(dirname "$0")/../.."

account="$(aws sts get-caller-identity --query Account --output text)"
echo "aws_account=$account"

capacity_name="$(aws ec2 describe-instances --instance-ids "$instance" \
  --query 'Reservations[0].Instances[0].Tags[?Key==`Name`].Value | [0]' --output text)"
echo "capacity_name=$capacity_name"
if [[ "$capacity_name" == "gascity-server" ]]; then
  echo "Refusing to touch gascity-server" >&2
  exit 2
fi

subnet="$(aws ec2 describe-instances --instance-ids "$instance" \
  --query 'Reservations[0].Instances[0].SubnetId' --output text)"
vpc="$(aws ec2 describe-instances --instance-ids "$instance" \
  --query 'Reservations[0].Instances[0].VpcId' --output text)"
echo "subnet=$subnet"
echo "vpc=$vpc"

aws ec2 describe-security-groups --group-ids "$security_group" --output json > /tmp/canary-sg.json
node --input-type=module << 'JS'
import { readFileSync } from "node:fs";
import { hostLabel } from "./scripts/gascity/canary-hosts.mjs";
import { assertCanaryDeploy } from "./deploy/canary/preflight.mjs";
const sg = JSON.parse(readFileSync("/tmp/canary-sg.json", "utf8")).SecurityGroups[0];
const rules = [];
for (const permission of sg.IpPermissions ?? []) {
  for (const range of permission.IpRanges ?? []) {
    rules.push({ cidr: range.CidrIp, port: permission.FromPort });
  }
}
const result = assertCanaryDeploy({
  canaryHost: hostLabel(process.env.WEWEBPLUS_DATABASE_URL ?? ""),
  rules,
  clusterName: "wewebplus",
  instanceId: "i-023d741ed3a1b3b25",
  securityGroupId: sg.GroupId,
});
console.log(`canary_host=${result.canaryHost}`);
JS

status="$(aws ecs describe-clusters --clusters "$cluster" \
  --query 'clusters[0].status' --output text)"
echo "cluster_status=$status"
if [[ "$status" != "ACTIVE" ]]; then
  echo "Cluster wewebplus is not active" >&2
  exit 2
fi

members="$(aws ecs list-container-instances --cluster "$cluster" --query 'length(containerInstanceArns)' --output text)"
echo "container_instances=$members"
if [[ "$members" == "0" ]]; then
  echo "Canary cluster has no container instance" >&2
  exit 2
fi

aws logs create-log-group --log-group-name /ecs/wewebplus-canary 2>/dev/null || true

if ! aws iam get-role --role-name wewebplus-canary-exec >/dev/null 2>&1; then
  aws iam create-role --role-name wewebplus-canary-exec \
    --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}' \
    >/dev/null
  aws iam attach-role-policy --role-name wewebplus-canary-exec \
    --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
  echo "execution_role=created"
else
  echo "execution_role=exists"
fi
role_arn="$(aws iam get-role --role-name wewebplus-canary-exec --query Role.Arn --output text)"
cat > /tmp/canary-exec-policy.json << EOF
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["secretsmanager:GetSecretValue"],"Resource":"arn:aws:secretsmanager:${region}:${account}:secret:wewebplus/canary/*"}]}
EOF
aws iam put-role-policy --role-name wewebplus-canary-exec \
  --policy-name canary-secrets --policy-document file:///tmp/canary-exec-policy.json
rm -f /tmp/canary-exec-policy.json

if [[ ! -s /tmp/tunnel-token ]]; then
  echo "Tunnel token file is absent" >&2
  exit 2
fi
umask 077
secret_file=/tmp/canary-secret-arns.json
echo "[" > "$secret_file"
first=1
put_secret() {
  local key="$1"
  local value="$2"
  local name="wewebplus/canary/${key}"
  local path="/tmp/canary-secret-value"
  printf '%s' "$value" > "$path"
  local arn
  if arn="$(aws secretsmanager describe-secret --secret-id "$name" --query ARN --output text 2>/dev/null)"; then
    aws secretsmanager put-secret-value --secret-id "$name" --secret-string "file://${path}" >/dev/null
  else
    arn="$(aws secretsmanager create-secret --name "$name" --secret-string "file://${path}" --query ARN --output text)"
  fi
  rm -f "$path"
  if [[ "$first" == "0" ]]; then echo "," >> "$secret_file"; fi
  first=0
  printf '{"name":"%s","valueFrom":"%s"}' "$key" "$arn" >> "$secret_file"
  echo "secret_ref=$key"
}
put_secret WEWEBPLUS_DATABASE_URL "${WEWEBPLUS_DATABASE_URL:-}"
put_secret WEWEBPLUS_SECRETS_KEY "${WEWEBPLUS_SECRETS_KEY:-}"
put_secret GAS_CITY_HOST_BRIDGE_TOKEN "${GAS_CITY_HOST_BRIDGE_TOKEN:-}"
put_secret CLERK_SECRET_KEY "${CLERK_SECRET_KEY:-}"
put_secret CLERK_PUBLISHABLE_KEY "${CLERK_PUBLISHABLE_KEY:-}"
put_secret NOVNC_PASSWORD "${NOVNC_PASSWORD:-}"
put_secret AWS_ACCESS_KEY_ID "${AWS_ACCESS_KEY_ID:-}"
put_secret AWS_SECRET_ACCESS_KEY "${AWS_SECRET_ACCESS_KEY:-}"
put_secret AWS_REGION "${AWS_REGION:-$region}"
if [[ -f /tmp/tunnel-token ]]; then
  put_secret TUNNEL_TOKEN "$(cat /tmp/tunnel-token)"
  rm -f /tmp/tunnel-token
fi
echo "]" >> "$secret_file"

namespace="$(aws servicediscovery list-namespaces \
  --query "Namespaces[?Name=='wewebplus'].Arn | [0]" --output text)"
if [[ -z "$namespace" || "$namespace" == "None" ]]; then
  operation="$(aws servicediscovery create-private-dns-namespace \
    --name wewebplus --vpc "$vpc" --query OperationId --output text)"
  for _ in $(seq 1 60); do
    state="$(aws servicediscovery get-operation --operation-id "$operation" --query Operation.Status --output text)"
    echo "namespace_state=$state"
    if [[ "$state" == "SUCCESS" ]]; then
      break
    fi
    if [[ "$state" == "FAIL" ]]; then
      echo "Cloud Map namespace failed" >&2
      exit 2
    fi
    sleep 5
  done
  namespace="$(aws servicediscovery list-namespaces \
    --query "Namespaces[?Name=='wewebplus'].Arn | [0]" --output text)"
fi
echo "namespace_set=yes"

dyad_image="${DYAD_IMAGE:?}"
supervisor_image="${SUPERVISOR_IMAGE:?}"
node deploy/canary/render-task.mjs \
  --dyad "$dyad_image" \
  --supervisor "$supervisor_image" \
  --secrets "$secret_file" \
  --subnet "$subnet" \
  --namespace "$namespace" \
  --task-definition wewebplus-canary \
  --task-out /tmp/canary-task.json \
  --service-out /tmp/canary-service.json
rm -f "$secret_file"

EXECUTION_ROLE_ARN="$role_arn" node --input-type=module << 'JS'
import { readFileSync, writeFileSync } from "node:fs";
const task = JSON.parse(readFileSync("/tmp/canary-task.json", "utf8"));
const service = JSON.parse(readFileSync("/tmp/canary-service.json", "utf8"));
task.executionRoleArn = process.env.EXECUTION_ROLE_ARN;
writeFileSync("/tmp/canary-task.json", JSON.stringify(task));
writeFileSync("/tmp/canary-service.json", JSON.stringify(service));
console.log("execution_role_attached");
JS

revision="$(aws ecs register-task-definition --cli-input-json file:///tmp/canary-task.json \
  --query 'taskDefinition.taskDefinitionArn' --output text)"
echo "task_definition_set=yes"
TASK_ARN="$revision" node --input-type=module << 'JS'
import { readFileSync, writeFileSync } from "node:fs";
const service = JSON.parse(readFileSync("/tmp/canary-service.json", "utf8"));
service.taskDefinition = process.env.TASK_ARN;
writeFileSync("/tmp/canary-service.json", JSON.stringify(service));
JS
existing="$(aws ecs describe-services --cluster "$cluster" --services wewebplus-canary \
  --query 'services[0].status' --output text 2>/dev/null || true)"
# An awsvpc service cannot be updated onto host networking. Replace it.
if [[ "$existing" == "ACTIVE" ]]; then
  current_mode="$(aws ecs describe-task-definition \
    --task-definition "$(aws ecs describe-services --cluster "$cluster" --services wewebplus-canary --query 'services[0].taskDefinition' --output text)" \
    --query 'taskDefinition.networkMode' --output text)"
  echo "current_network=$current_mode"
  if [[ "$current_mode" != "host" ]]; then
    aws ecs delete-service --cluster "$cluster" --service wewebplus-canary --force >/dev/null
    for _ in $(seq 1 60); do
      existing="$(aws ecs describe-services --cluster "$cluster" --services wewebplus-canary \
        --query 'services[0].status' --output text)"
      echo "service_status=$existing"
      if [[ "$existing" == "INACTIVE" ]]; then
        break
      fi
      sleep 5
    done
  fi
fi
if [[ "$existing" == "ACTIVE" ]]; then
  aws ecs update-service --cluster "$cluster" --service wewebplus-canary \
    --task-definition "$revision" --desired-count 1 \
    --availability-zone-rebalancing DISABLED \
    --deployment-configuration "minimumHealthyPercent=0,maximumPercent=100" >/dev/null
  echo "service=updated"
else
  aws ecs create-service --cluster "$cluster" --cli-input-json file:///tmp/canary-service.json >/dev/null
  echo "service=created"
fi
rm -f /tmp/canary-task.json /tmp/canary-service.json /tmp/canary-sg.json
