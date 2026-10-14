# Redeploy the formula preview

The formula service is already defined. The missing piece was DNS. Doppler `dyad/preview` `CLOUDFLARE_API_TOKEN` has been replaced, and a check on 2026-10-11 showed the new value is active and can create a DNS record in the formula zone. This plan reruns the existing **Preview formula** workflow. It does not change the token, the image, or the service shape.

## What is already true

- The public name is `https://formula.anakwannaphaschaiyong.com`.
- The workflow is `.github/workflows/preview-formula.yml` on `cursor/formula-config-ui-55d6` at `c48314f5`.
- That commit's image was published. The later deploy failed in **Update the formula service** with `Cloudflare request failed: Authentication error` before any formula DNS record was written. Runs: [38130909738](https://github.com/Awannaphasch2016/dyad/actions/runs/38130909738) and [38132191218](https://github.com/Awannaphasch2016/dyad/actions/runs/38132191218).
- The replacement token is a different value from the expired token and from the Bolt Workers token. Account verify reports `active`. DNS read and DNS write on the formula zone returned 200, and the probe record was deleted. Run: [38155172610](https://github.com/Awannaphasch2016/dyad/actions/runs/38155172610).
- `CLOUDFLARE_ZONE_ID` and `CLOUDFLARE_ACCOUNT_ID` in `dyad/preview` stay as they are.
- DNS writes are limited to `formula.anakwannaphaschaiyong.com` and the ACM validation name under that hostname. A `pr-<n>` tunnel name is refused.

## How to run it

Run **Preview formula** with `workflow_dispatch` on branch `cursor/formula-config-ui-55d6`. Use the current head, `c48314f5`. Do not add a commit. A new commit is a new image tag, and the publish job builds that image only when the tag is missing.

The Actions UI is **Actions → Preview formula → Run workflow → Branch: cursor/formula-config-ui-55d6**.

This agent's GitHub token received HTTP 403 on `workflow_dispatch`, so the run button has to be used by an account that can start Actions.

## What the run does

The workflow has three jobs. `role` and `publish` can finish while `deploy` is still running. `deploy` waits for both.

1. `role` reads `AWS_PREVIEW_FORMULA_ROLE_ARN` from Doppler or the GitHub secret. The role must still trust `repo:Awannaphasch2016@28061800/dyad@1384672033:ref:refs/heads/cursor/formula-config-ui-55d6`.
2. `publish` looks up `ghcr.io/awannaphasch2016/dyad:sha-c48314f5`. For this commit the tag is already published, so it does not build.
3. `deploy` resolves that GHCR digest, attaches the Neon preview branch for the open pull request on this branch, assumes the AWS role in `ap-southeast-1`, and copies the digest into ECR repository `dyad-formula-preview`.
4. `formula_ecs.mjs sync` keeps the existing cluster `wewebplus-formula-preview`, service `formula-preview`, and load balancer. Desired count stays 1. It registers a task definition for the ECR digest and waits until the service is stable.
5. After the service is stable, sync requests or reuses the ACM certificate for `formula.anakwannaphaschaiyong.com`, writes the validation CNAME and the proxied CNAME to the load balancer, waits until ACM reports `ISSUED`, and adds the HTTPS listener on port 443 if it is not already there.
6. The job then requests these three paths and requires HTTP 200 plus `data-dyad-browser-bridge`:
   - `https://formula.anakwannaphaschaiyong.com/formulas/discovery`
   - `https://formula.anakwannaphaschaiyong.com/formulas/implementation`
   - `https://formula.anakwannaphaschaiyong.com/formulas/delivery`

The sync step must print `url=https://formula.anakwannaphaschaiyong.com`. Any other line fails the job.

## What done looks like

- The **Preview formula** run is green.
- The log contains `CLOUDFLARE_API_TOKEN: present` and does not contain `Authentication error`.
- The three formula paths above return 200 from outside the job, and each page contains `data-dyad-browser-bridge`.
- The same URL still answers after the job ends. Nothing in this run sets the desired count to 0.
- `https://pr-34.anakwannaphaschaiyong.com` and the other pull-request tunnel names are unchanged.

## Out of scope

- Minting another Cloudflare token, or copying the Bolt token into `dyad/preview`.
- Editing `pr-<n>` tunnel DNS, waking the Devbox, or running `cloudflared`.
- Rebuilding `Dockerfile.gascity` or changing the task size, secrets list, or bridge bind address.
- A new commit on `cursor/formula-config-ui-55d6`.

## If it fails

| Log | What it means |
| --- | --- |
| `Authentication error` or `Invalid access token` on the Cloudflare call | Doppler `dyad/preview` `CLOUDFLARE_API_TOKEN` is not the value that passed the DNS write check. Stop and compare again. Do not create a second token. |
| `AWS_PREVIEW_FORMULA_ROLE_ARN is absent` or an assume-role error | The role secret or the branch trust changed. Fix that before retrying. The DNS token is not the cause. |
| `services-stable` times out | The task did not become healthy. DNS has not been written yet. Read the ECS service events and the task logs in `/ecs/formula-preview`. |
| `ACM certificate was not issued` | The validation CNAME was written and ACM did not finish. Leave the record in place and rerun. A second run reuses the pending certificate. |
| The page check never sees `data-dyad-browser-bridge` | DNS and the listener exist, and the app on port 8373 is not serving the formula page. The task is the place to look. |

## Decision

Rerun the workflow that is already on `c48314f5`. The token check is done. The redeploy is the dispatch, the green job, and the three HTTPS pages.
