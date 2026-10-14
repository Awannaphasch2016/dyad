# Formula pages

The three phase pages are in. Each page edits one GasCity formula file.

## Important points

1. Discovery, Implementation, and Delivery each have a page at `/formulas/discovery`, `/formulas/implementation`, and `/formulas/delivery`.
2. Each page owns one file: `<cityRoot>/formulas/discovery.toml`, `implementation.toml`, or `delivery.toml`. The `formula` name inside the file matches the page.
3. GasCity keeps the current file. `wewebplus.formula_revisions` in the preview Postgres keeps one full-text row per successful save, for reload and undo. Beads stay the result of a later cook. `wewebplus.audit_events` stays an action log.
4. A missing file shows a starter. The starter is written only when the user saves. A missing supervisor address shows the error and writes nothing. The preview `/city` volume is empty and is not the GasCity city.
5. Save validates, then `PUT`s the file, then inserts the history row. Undo writes the previous history row back through that same save, so the older text becomes a new row. One page leaves the other two files and their history alone.
6. Validate parses the TOML, runs GasCity `Validate`, checks that the `formula` name matches the page, and resolves `extends`. It rejects a missing or mismatched formula name, a step missing `id` or `title`, and `needs` that names a missing step. A misspelled key is ignored. `metadata.gc.run_target` is copied as text. Validate writes nothing and creates no beads.
7. A dependency cycle can pass validate. `gc formula show discovery|implementation|delivery` on the GasCity host is the compile check. It prints the compiled steps and `*.workflow-finalize` and creates no beads. GitHub Actions does not run it.
8. Writes send `X-GC-Request`, and `X-GC-City-Write` when the city requires a grant. The pages do not cook, sling, or create or close beads.
9. The pages ship in the existing `dyad` image through `.github/workflows/preview-formula.yml`: one ECS service in `ap-southeast-1` that stays up. `gascity-rollout.yml` is the production host. The DevBox from `preview-image.yml` is not the formula preview to keep open.
10. Web builders stay unwired. Pointing DYAD, Forma, Bolt, or Vibe SDK at these files, or cooking and slinging them, is a later change.
11. Extend the formula service that the load balancer already serves. The pages call GasCity's existing formula routes for source, validate, and save, and the load balancer forwards to that same service. `https://formula.anakwannaphaschaiyong.com` is a DNS name and a port 443 listener on that load balancer. Publishing the name needs a Cloudflare token in Doppler `dyad` / `preview` that can edit DNS on `anakwannaphaschaiyong.com`. Until that token is accepted, keep using the load balancer URL. The token is a DNS credential, and it does not call for a second formula service or a second compiler.
