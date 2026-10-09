# Spec-driven development experiments

Harness for the experiment described in [`plans/sdd-speckit-experiment.md`](../../plans/sdd-speckit-experiment.md): a Cursor Cloud Agent (the coordinator) launches a second Cloud Agent (the worker) that implements a website from a fixed specification with GitHub Spec Kit, then a GitHub Actions job (the verifier) builds the result and runs acceptance tests the worker never saw.

Nothing in this directory touches Dyad's application code or production workflows. `.github/workflows/sdd-verify.yml` triggers only on this branch and only on `experiments/sdd/runs/**/run.json`.

## Layout

| Path                              | Role                                                                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `specs/gitcon/v1/requirements.md` | The fixed specification the worker receives, rendered from `requirements.template.md` plus `fixtures/*.json` by `bin/build-spec.mjs` |
| `specs/gitcon/v1/acceptance/`     | Verifier-only: `criteria.md` (AC table), Playwright tests, `reporter.mjs`                                                            |
| `bin/`                            | Coordinator scripts, Node built-ins only                                                                                             |
| `schema/`                         | JSON Schemas for `run.json` and `results.json`                                                                                       |
| `pricing.json`                    | Pinned list prices used to turn measured tokens into estimated USD                                                                   |
| `runs/<run-id>/`                  | `run.json`, `results/results.json`, `results/report.md`, `results/worker-stream.jsonl`, `results/usage.json`                         |

## Prerequisites

- `CURSOR_API_KEY` as a Cloud Agent Runtime Secret on this repository (user or service-account key).
- An implementation repository (default `Awannaphasch2016/sdd-gitcon-impl`) with the Cursor GitHub App installed and a tag `baseline/speckit-1.1.2` produced by `specify init --integration cursor-agent` (plan D.3).
- `gh` authenticated with read access to the implementation repository (the coordinator VM has it).

## One experiment

```bash
RUN=$(date -u +%F)-gitcon-v1-speckit-01
node experiments/sdd/bin/build-spec.mjs --check
node experiments/sdd/bin/preflight.mjs --run-id "$RUN" --model <model id>      # writes runs/$RUN/run.json or fails
node experiments/sdd/bin/start-worker.mjs --run-id "$RUN"                      # POST /v1/agents
node experiments/sdd/bin/watch-worker.mjs --run-id "$RUN"                      # polls, saves stream, fills pr.head_sha
git add experiments/sdd/runs/"$RUN"/run.json && git commit -m "sdd: run $RUN" && git push
# wait for the "SDD verify" workflow on that commit, then:
gh run download <actions run id> -n "sdd-$RUN-evidence" -D experiments/sdd/runs/"$RUN"/evidence
node experiments/sdd/bin/collect-usage.mjs --run-id "$RUN" --verifier-run <actions run id>
node experiments/sdd/bin/report.mjs --run-id "$RUN"
git add experiments/sdd/runs/"$RUN" && git commit -m "sdd: results for $RUN" && git push   # results/ does not retrigger the verifier
```

Pushing `evidence/` is optional; it holds the Playwright report, traces and videos and can be large. `results/` is always committed.

## Smoke test (plan D.4)

Not yet executed. Until a run id under `runs/` carries a verifier URL and a `results.json`, this harness is not claimed to work.

## Leak markers

`bin/leak-scan.mjs` flags any of: the ground-truth repository name, the live site host, the agency's asset host, this repository's name, the original template path, and this directory's path. Hits in the worker's tree or stream mark the run `contaminated`.
