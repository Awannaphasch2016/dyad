# Add a Doppler name that does not exist yet

The formula job can copy `GAS_CITY_SUPERVISOR_URL`, `GAS_CITY_CITY_NAME`, and `GAS_CITY_CITY_WRITE_GRANT` into Doppler project `dyad`, config `preview`. It creates nothing when every config is empty. The same writer should create an allowlisted name from a GitHub Actions secret of that name.

## Important points

1. One writer serves both jobs. Preview formula runs it before the Neon attach, so the same deploy exports the new names. A second workflow runs only the writer, on `workflow_dispatch`, with push paths limited to the writer files. Adding a name does not by itself rebuild the formula image.
2. The allowlist lives in the repo. It starts with those three GasCity names. A new name is a change to that list. When the formula task must receive it, the same change adds it to the preview runtime keys. The value stays out of git.
3. For each allowlisted name the writer tries, in order, a usable value already in `dyad` / `preview`, then `dyad` / `prd` and `dyad` / `canary`, then the production host when SSH answers, then the GitHub Actions secret of the same name. The secret is passed only for allowlisted names. `DOPPLER_ADMIN_TOKEN` is not one of them.
4. The first usable value is posted to `dyad` / `preview`. Doppler creates the name when it is missing. A usable value already in `preview` is left as it is. An empty secret does not clear a stored value.
5. The log line is `NAME: present`, `copied`, `created`, or `absent`. The value is not printed. The job keeps `set +x`.
6. `GAS_CITY_SUPERVISOR_URL` is stored only as `http` or `https`, and only when the host is not loopback, private, or link-local. The city name must match the existing city pattern. The grant stays optional. Any other allowlisted name must be non-empty and must not contain a newline.
7. A missing secret leaves that Doppler name absent. The writer does not invent a value. Preview formula still finishes. Validate and Save stay off until both required names are in the task.
8. A writer-only run changes Doppler and does not replace the running task. The next Preview formula run is what exports the names and turns the buttons on.
9. The writer does not cook, sling, open port 8372, or run `gascity-rollout.yml`.
10. This plan does not supply the supervisor address. `preview`, `prd`, and `canary` are empty for those names, and the production host SSH port does not answer. After this writer exists, the repository secrets `GAS_CITY_SUPERVISOR_URL` and `GAS_CITY_CITY_NAME` are what the action can store.
