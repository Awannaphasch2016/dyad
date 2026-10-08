# Merge and validate preview-forma

> This is a plan. It does not merge, does not deploy, and does not change Clerk.

## Execution

Draft PR 82 adds the label path in this repository. It does not start a container.

- The `preview-forma` label on a pull request here reads `deploy/preview-forma/compose.yml`. Every service must pin `ghcr.io/awannaphasch2016/<name>:sha-<40 hex>` or `@sha256:<64 hex>`. A `build` key is rejected. The committed pin is `sha-80a8e419f6285378b4dfada336ea8213f3089bab`.
- The Dyad `preview` label is not this workflow. Closing a pull request without `preview-forma` does not destroy anything.
- The job asks for `permission-packages: read`. `PREVIEW_FORMA_DOCKER_HOST` is unset, so it stops before Doppler, Neon, and Docker.
- Cleanup would use Neon branch `preview-forma-<number>` in `divine-credit-21002460`, parent `br-round-night-b33xeq5p`. It refuses `forma-pr-*`, `proud-salad-68182047`, `ep-young-wave-b3cwe0rz`, Devbox `Wewebplus-ci`, and `weaver-plus`. With no host it logs `preview_forma_down=skipped` and does not call Neon. `forma-pr-2` is untouched.
- **Publish Forma image** is not on `forma` `main`. A local commit on `cursor/publish-image-main-5014` could not be pushed: `cursor[bot]` receives HTTP 403 from `Awannaphasch2016/forma`. The image that already exists is still the walkthrough tag above.
- The Docker host is still unchosen. That is the blocker before a live label test.

This repository is the orchestrator. A preview pull request here can run more than one container, including more than one image from the same builder repository. The label belongs on that pull request. Forma, Bolt, and Vibe SDK only publish images. Moving those applications out of this repository waits until the orchestration pattern is stable.

## Direction

The earlier draft watched a `preview-forma` label on a Forma pull request, then uploaded that git commit to Vercel. That cannot describe a preview made of several images, and GitHub will not deliver a Forma label into a workflow in this repository.

The revised shape:

1. A builder repository publishes `ghcr.io/awannaphasch2016/<name>:sha-<commit>`. Forma already does this on `cursor/forma-preview-walkthrough`. The image for `80a8e419f6285378b4dfada336ea8213f3089bab` is `ghcr.io/awannaphasch2016/forma@sha256:b9e58a3c060b99bcfe19426a9def8b5dfd145956d9effc6034d9e8c6239592b2`.
2. A pull request in this repository pins those tags in one Compose file. One service is a Forma-only preview. A second service is another image line, from Forma or from another repository.
3. The label on **this** pull request starts the workflow. The workflow pulls the pinned images and runs Compose. It does not clone the builder to run `docker build`, and it does not upload the builder's source to Vercel.
4. Removing the label, or closing the pull request, stops that Compose project and deletes only the preview database for that pull request.

The existing `preview` label stays the Dyad Devbox preview. This workflow uses a different label so the two do not start each other. `preview-forma` is the first label. The Compose file is what allows a second container. Renaming the label can wait until a second builder is actually in the file.

The Docker host that runs Compose is not chosen here. It is not the production EC2 host. It is not Devbox `Wewebplus-ci`, because that machine is the Dyad `preview` label. Picking the host is a blocker before a live label test, not a reason to put the label back on Forma.

## What was already proven

These facts stay true. They describe the Vercel source deploy, which this direction replaces.

- Empty inputs fail before Doppler, Neon, or Vercel. Run [37801804857](https://github.com/Awannaphasch2016/dyad/actions/runs/37801804857).
- Pull request 2 of Forma deployed commit `80a8e419f6285378b4dfada336ea8213f3089bab` to https://forma-p2q19xkaj-anak2.vercel.app. Run [37802103230](https://github.com/Awannaphasch2016/dyad/actions/runs/37802103230). `GET /api/status` is `{"configured":true,"provider":"openrouter"}`. A wrong password returns 401.
- That run used Doppler `forma/dev`, Neon branch `forma-pr-2` on `ep-twilight-wildflower-b3fwtiew`, and the Vercel project `forma`. It updated `OPENROUTER_API_KEY`. It did not set `APP_URL` or any `OPENAI_*` name.
- `FORMA_ENVIRONMENT=canary` exits before Doppler.
- **Publish Forma image** run [37768316995](https://github.com/Awannaphasch2016/forma/actions/runs/37768316995) pushed the digest above. The package is private. This session can read that Actions log and gets HTTP 403 on the manifest. The deploy job did not request packages on its token, so it logged `forma_image=unavailable`. The installation already grants packages read and write.

## What changes from the current plan

| Current plan                                   | Revised                                                                                                                                                                                                         |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Label on a Forma pull request                  | Label on a pull request in this repository                                                                                                                                                                      |
| Schedule that lists Forma pull requests        | `pull_request` in this repository, same as the Dyad `preview` workflow, for the `preview-forma` label                                                                                                           |
| `repository_dispatch` from outside             | Not the label path. **Run workflow** can still deploy one pinned Compose file                                                                                                                                   |
| Vercel upload of Forma's source                | `docker compose` pull and up of the pinned images                                                                                                                                                               |
| One Forma commit per preview                   | One Compose file, one or more image tags                                                                                                                                                                        |
| Neon branch `forma-pr-<forma number>`          | Neon branch for **this** pull request number, still under `divine-credit-21002460`, parent `br-round-night-b33xeq5p`                                                                                            |
| Public URL is a Vercel preview URL             | Public URL is whatever the chosen Docker host exposes. The Vercel URL above remains the old proof                                                                                                               |
| Re-read the Forma label before writing the URL | The workflow is the labeled pull request. Unlabel and close are events in this repository. `commandForPullRequest(event, "preview-forma")` already returns `update` or `destroy` and is not wired to a workflow |

Forma does not get a new workflow besides image publish. Publish currently runs only on a push to `cursor/forma-preview-walkthrough`. `forma` `main` has a Dockerfile and no workflow. A tag has to exist before an orchestrator pull request can pin it.

## Lifecycle

| Step                                                                                                   | Expected                                                                                                   | Actual today                                                                  |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1. Add `preview-forma` to a pull request in this repository whose Compose file pins one or more images | `preview-forma` workflow starts                                                                            | The workflow has no `pull_request` trigger. Adding the label does nothing     |
| 2. The workflow pulls those tags                                                                       | Log shows each digest                                                                                      | The job never requests packages, so it cannot pull the private manifest       |
| 3. Compose starts the containers                                                                       | Each service is the pinned tag, not a local build                                                          | Nothing runs the Forma image. The old path uploads source to Vercel           |
| 4. Database                                                                                            | Neon branch for this pull request, parent `br-round-night-b33xeq5p`                                        | `forma-pr-2` exists from the Vercel proof. It is not this lifecycle           |
| 5. The app answers                                                                                     | OpenRouter status, wrong password 401                                                                      | True for https://forma-p2q19xkaj-anak2.vercel.app, which is the source deploy |
| 6. A new commit on the labeled pull request                                                            | If the Compose pins changed, pull and recreate. If they did not, leave the containers                      | Not implemented                                                               |
| 7. Remove the label or close the pull request                                                          | Compose project stops. That pull request's Neon branch is deleted. GHCR tags stay. The parent branch stays | Not implemented. `forma-pr-2` and the Vercel URL are still up                 |

## Before any merge

1. Choose the Docker host. Not the production EC2 host. Not Devbox `Wewebplus-ci`.
2. Move **Publish Forma image** onto `forma` `main` so a commit SHA can be pinned. The workflow already exists on the walkthrough branch.
3. The job that pulls requests `permission-packages: read`. The installation already allows it.
4. Add `on.pull_request` for `labeled`, `unlabeled`, `synchronize`, `reopened`, and `closed`, limited to the `preview-forma` label, in this repository. Do not add that trigger to the Dyad `preview` workflow.
5. `down` deletes only the Neon branch for this pull request. Refuse parent `br-round-night-b33xeq5p`, project `proud-salad-68182047`, and host `ep-young-wave-b3cwe0rz`.
6. Do not merge PR 77 as it stands. That file deploys Forma's source to Vercel and does not run Compose.

Shared Clerk sign-in stays out. Bolt's plan on `cursor/shared-auth-substrate-55d6` (PR 76) says Forma waits until Bolt's two-person check passes.

## Label test, after the host exists

Use a new pull request in this repository. Pin `ghcr.io/awannaphasch2016/forma:sha-80a8e419f6285378b4dfada336ea8213f3089bab`. Add `preview-forma`.

1. The run logs that digest and starts Compose.
2. The public URL returns OpenRouter status. A wrong password returns 401.
3. Add a second service line and push. The new run starts both containers.
4. Remove the label. Both containers stop. The Neon branch for this pull request is gone. The parent branch remains. The GHCR tag remains.
5. Do not use this test to delete `forma-pr-2` or the Vercel proof URL. Those belong to the old path.
