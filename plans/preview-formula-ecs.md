# Preview formula on ECS

The formula pages stay up by running the existing `dyad` container as one ECS service. The link is the load balancer. The service keeps desired count 1 after the GitHub Actions job ends, so nobody resumes a tunnel.

This plan does not investigate why the DevBox preview drops. It does not change `preview-image.yml`, `preview-wake.yml`, or `gascity-rollout.yml`.

## What you can check

1. A push to `cursor/formula-config-ui-55d6`, or a manual run, starts the workflow **Preview formula**.
2. The log prints one `http://….ap-southeast-1.elb.amazonaws.com` address and does not print secret values.
3. `/formulas/discovery`, `/formulas/implementation`, and `/formulas/delivery` on that address return HTTP 200 and the page contains `data-dyad-browser-bridge`.
4. The same address still opens after the job ends. There is no resume step.
5. From the internet, port 32100 and port 6080 do not answer. Only the load balancer reaches port 8373.
6. The log does not cook or sling, and it does not call `gascity-rollout.yml`.
7. A desktop launch and the DevBox compose file still bind the browser bridge to `127.0.0.1` unless `DYAD_BROWSER_BRIDGE_HOST` is set.

## What this adds

| Piece                                   | Role                                                                        |
| --------------------------------------- | --------------------------------------------------------------------------- |
| `.github/workflows/preview-formula.yml` | Build or reuse the image, push it to ECR, update the service, print the URL |
| `DYAD_BROWSER_BRIDGE_HOST`              | Lets this task listen on `0.0.0.0`. Default stays `127.0.0.1`               |
| One Fargate service, desired count 1    | The container that stays running                                            |
| One internet-facing load balancer       | The stable link. No Cloudflare name is required                             |

The image is still `Dockerfile.gascity`. The workflow reuses `ghcr.io/<owner>/dyad:sha-<commit>` when that tag already exists, and builds it only when it does not. It copies that digest into a private ECR repository and points the task at the ECR digest. ECS does not pull from GHCR.

There is one service, `formula-preview`, in cluster `wewebplus-formula-preview`, region `ap-southeast-1`. A later push replaces the task definition and waits until the new task is healthy. The old task stays until then. Desired count stays 1. The workflow never sets it to 0.

## Listen address

`startBrowserBridgeFromEnv` today reads `DYAD_BROWSER_BRIDGE_PORT` and leaves the host at `127.0.0.1`. A load balancer cannot connect to loopback inside the task.

The code change:

- Read `DYAD_BROWSER_BRIDGE_HOST`.
- Accept only `127.0.0.1` and `0.0.0.0`. Anything else, including an empty value, uses `127.0.0.1`.
- Pass that host into `startBrowserBridge`, which already listens on `options.host`.
- The formula task sets `DYAD_BROWSER_BRIDGE_HOST=0.0.0.0` and `DYAD_BROWSER_BRIDGE_PORT=8373`.
- DevBox `compose.preview.yml` does not set the host, so its bridge stays on loopback.

A unit test covers the default, `0.0.0.0`, and a rejected value.

## Task shape

Fargate, Linux/x64, 2 vCPU, 8 GB memory. `linuxParameters.sharedMemorySize` is 1024 so Chromium gets the same 1 GB `/dev/shm` that `compose.preview.yml` sets with `shm_size: 1gb`. Ephemeral storage is 40 GB. The platform version is one that supports that shared-memory setting.

Container port mapping is only 8373. The process may still listen on 32100 and 6080 inside the task network. The task security group has no ingress on those ports. Ingress on 8373 allows only the load balancer security group.

The image health check stays the Dockerfile check: local noVNC on 6080, and factory-state on 32100 returning 401. The load balancer's own check is `GET /` on 8373, expecting 200. The service health-check grace period is 180 seconds. The load balancer idle timeout is 3600 seconds so the browser-bridge WebSocket stays open while the page is open.

The task has no EFS volume. Formula text that was saved lives on the GasCity supervisor. Undo history lives in Postgres. Replacing the task does not need the old disk.

## What the task receives

Non-secret environment:

| Name                           | Value            |
| ------------------------------ | ---------------- |
| `DYAD_BROWSER_BRIDGE`          | `1`              |
| `DYAD_BROWSER_BRIDGE_PORT`     | `8373`           |
| `DYAD_BROWSER_BRIDGE_HOST`     | `0.0.0.0`        |
| `GAS_CITY_HOST_BRIDGE_ENABLED` | `true`           |
| `GAS_CITY_HOST_BRIDGE_HOST`    | `0.0.0.0`        |
| `GAS_CITY_HOST_BRIDGE_PORT`    | `32100`          |
| `AWS_REGION`                   | `ap-southeast-1` |

Secrets come from Secrets Manager. The workflow copies them from the Doppler download the preview job already uses, and it does not print the values. Names:

- `WEWEBPLUS_DATABASE_URL` — the Neon branch `preview-pr-79`, attached with the existing preview controller
- `WEWEBPLUS_SECRETS_KEY`
- `CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `NOVNC_PASSWORD` — generated once and kept. The entrypoint exits without it
- `GAS_CITY_HOST_BRIDGE_TOKEN` — generated once and kept
- `GAS_CITY_SUPERVISOR_URL`, `GAS_CITY_CITY_NAME`, and `GAS_CITY_CITY_WRITE_GRANT` when Doppler has them

Those three GasCity names are not written into `compose.preview.yml`. An empty compose `environment` entry would hide a real `env_file` value. If the supervisor URL or city name is missing, the page still loads and shows that the supervisor is not configured. It does not write a formula file on the task disk.

The deploy identity and the Bedrock keys are different. The job assumes a GitHub OIDC role to create and update this service. The Bedrock keys above are injected into the container and are not the keys that call the ECS API.

## Workflow

File: `.github/workflows/preview-formula.yml`. Name: Preview formula.

Triggers: `workflow_dispatch`, and `push` to `cursor/formula-config-ui-55d6`.

Permissions: `contents: read`, `packages: read`, `id-token: write`. Package write is added only on the job that builds a missing GHCR tag.

Concurrency group `preview-formula-ecs`, cancel-in-progress false.

Steps:

1. Check out the commit.
2. Resolve `ghcr.io/<owner>/dyad:sha-<commit>`. Build and push `Dockerfile.gascity` only when that tag is absent.
3. Assume the AWS role with OIDC. No access key is written into the workflow file.
4. Create the ECR repository if it is missing. Copy the digest in. The task definition records the digest, not a moving tag.
5. Attach Neon branch `preview-pr-79` with `deploy/preview/controller.mjs`. Write the runtime values into Secrets Manager without logging them.
6. Create the cluster, load balancer, target group, security groups, and service when they are missing. Otherwise register a new task definition and update the service.
7. Wait until the service is stable.
8. Curl `http://<alb-dns>/formulas/discovery` until the status is 200 and the body contains `data-dyad-browser-bridge`. Print the three phase URLs.

The workflow does not run `gc`, does not call cook or sling, and does not SSH to the production host.

## One account step before the first green run

This repository has no ECS cluster and no GitHub-to-AWS role. The first run needs a role, created once, that this workflow can assume:

- Trust: GitHub OIDC for `repo:Awannaphasch2016/dyad:ref:refs/heads/cursor/formula-config-ui-55d6`.
- Permissions: ECR for the formula-preview repository, ECS for this cluster and service, the load balancer and target group, the task security group, and the Secrets Manager entries this workflow writes. CloudWatch Logs for the task. PassRole on the task execution role.

The workflow does not fall back to a long-lived key in the YAML, and it does not ask for `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_ZONE_ID`. If the role is missing, the job stops at the assume step.

## Out of scope

- Debugging DevBox disconnects, quick tunnels, or the named hostname `pr-79.anakwannaphaschaiyong.com`.
- A custom domain. The load balancer DNS name is the link. A hostname on `anakwannaphaschaiyong.com` can wait until the unsuffixed Cloudflare names exist.
- Cooking, slinging, or running `gc formula show` from Actions.
- Wiring Discovery, Implementation, or Delivery into DYAD, Forma, Bolt, or Vibe SDK.
- More than one formula service, or a service per pull request.
- Stopping the service when the job ends.
