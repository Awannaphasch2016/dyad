# Run the formula check live

The Discovery page can save only when the formula task can open the production GasCity supervisor. `gc formula show` can run only in a shell on that host. Both are closed today.

## Important points

1. Full live means one discovery save, one rejected formula, and one host compile check. Validate says the formula is acceptable. Save says Saved. Reload shows that text. Changing the first line to `formula = "delivery"` does not save. `gc formula show discovery` on the production host prints `confirm` and `discovery.workflow-finalize`. The other two formula files stay unchanged. The run does not cook, sling, or run `gascity-rollout.yml`.
2. The formula task and the host are different machines. The supervisor listens on `127.0.0.1:8372` on `13.251.216.187`. Port 22 on that host does not answer, so the job cannot start `gc`.
3. A read-only check prints the instance state and whether TCP 22 has an ingress rule. It does not change a security group and does not print secrets. A stopped instance is started before the rest of the run.
4. The shell uses the SSH key the role job already uses. If port 22 has no ingress, restore ingress for the GitHub-hosted runner ranges. Session Manager is the fallback when the instance is already managed and port 22 stays closed. The formula role does not gain permission to open port 8372.
5. On the host, a script prints the city name and `listen=loopback` or `listen=reachable`. It does not print tokens. `gc formula show` runs only after a successful save, and the log keeps the step names.
6. The supervisor stays on loopback. A named Cloudflare tunnel on the host forwards to `http://127.0.0.1:8372`, and Cloudflare Access requires a service token. The public security group does not gain port 8372. If the Cloudflare token cannot create the tunnel, the job stops.
7. The tunnel hostname is `GAS_CITY_SUPERVISOR_URL`. The city name is `GAS_CITY_CITY_NAME`. The Access client id and secret are new allowlisted names. The existing writer stores them in Doppler `dyad` / `preview` and still rejects a loopback address. The grant stays optional.
8. The formula client sends the Access headers on source, validate, and save. The next Preview formula run exports the names into the task. Validate and Save stay off until the page no longer says the supervisor is missing.
9. The live check then pastes the discovery formula, validates, saves, reloads, and rejects the mismatched name. The host shell runs `gc formula show discovery` after that save.
10. This plan does not open the host or store an address. Port 22 still times out, and Doppler still has no supervisor URL.
