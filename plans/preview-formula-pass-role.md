# Pass the formula role address into the deploy job

**Preview formula** already finds `AWS_PREVIEW_FORMULA_ROLE_ARN` in Doppler. The deploy job then stops before it creates the ECS service. Nothing else is missing. You do not add a secret, replace a host token, or open an AWS page.

## What happened

Run [37982171544](https://github.com/Awannaphasch2016/dyad/actions/runs/37982171544) on `cursor/formula-config-ui-55d6`:

- **publish** succeeded.
- **role** printed `present` and `AWS role is set`.
- **deploy** stopped at **Assume the AWS role** with `Could not load credentials from any providers`.

The role job hides the address and then saves it as the job output:

```yaml
echo "::add-mask::$arn"
echo "arn=$arn" >> "$GITHUB_OUTPUT"
```

GitHub removes a hidden value from job outputs. **Assume the AWS role** reads `needs.role.outputs.arn`, receives an empty address, and has no AWS login to use. The trust line and the Doppler name are already correct.

The address is the name of the role. It is not a key. The workflow can print `AWS role is set` and still pass the address to the next job.

## What you do

Nothing. The Doppler name is already stored in project `dyad`, config `preview`. The production host token files are still HTTP 401. This plan does not use those files.

## Change

In `.github/workflows/preview-formula.yml`, the role job writes the address to `GITHUB_OUTPUT` and does not hide it first. `role-to-assume` stays `${{ needs.role.outputs.arn }}`.

The unit test for that workflow file asserts the role step does not contain `::add-mask::`, and that the deploy job still assumes `needs.role.outputs.arn`.

No other workflow changes. **Formula preview role** is not run again. **Gas City rollout** is not run.

## What you can check

1. A push to `cursor/formula-config-ui-55d6` starts **Preview formula**. The role job prints `AWS role is set` on the first look, because the Doppler name is already there.
2. **Assume the AWS role** finishes, and the log does not print `Could not load credentials from any providers`.
3. The log prints one `http://….ap-southeast-1.elb.amazonaws.com` address.
4. `/formulas/discovery`, `/formulas/implementation`, and `/formulas/delivery` on that address return HTTP 200 and the page contains `data-dyad-browser-bridge`.
5. The address still opens after the job ends.
6. The log does not print the SSH key, the AWS keys, or a Doppler token.

The new commit has a new SHA, so **publish** builds `ghcr.io/<owner>/dyad:sha-<that-sha>` once. Later pushes of the same SHA reuse it. The image build is the long part. The role lookup is not.
