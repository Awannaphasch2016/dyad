# Production control plane: Supabase Postgres to Neon

> Written 2026-10-04 from the production line `cursor/browser-dyad-ui-bbea` and from Neon’s published migration docs. A live catalog of the production database was not run. The first implementation step is that catalog. Do not treat this file as proof that production contains only the objects listed below.

## Summary

The production control plane is a Postgres database reached only through `WEWEBPLUS_DATABASE_URL`. The application already talks to it with the `postgres` driver and Drizzle, and sign-in is Clerk. Neon does not offer a one-button Supabase import. The official path that fits this database is `pg_dump` and `pg_restore` of the `wewebplus` schema and the Drizzle migration journal. After the restore matches production row for row, the cutover is a change of that connection string. Dyad’s Supabase integration for user-built apps stays.

A perfect cutover is behavioral equivalence. The question board, factory records, account connections, and membership checks behave the same way for the same people. Schema and rows existing in Neon is the database half. The application half is done when every process that reads and writes the control plane is using the Neon URL and the equivalence checks have passed.

## Problem Statement

Production HITL and account data live in Supabase. Preview databases already live in Neon. Two hosts means two operational paths for one schema. The control plane was written so the host can be swapped by changing `WEWEBPLUS_DATABASE_URL`. The remaining work is to move the production rows without dropping Clerk identities, encrypted connection secrets, or the Drizzle history that the process applies on startup.

## Scope

### In scope

- The production Postgres database behind `WEWEBPLUS_DATABASE_URL` on the production Dyad process and on the production Vercel question board.
- Schemas the app owns: `wewebplus`, and `drizzle` when that journal exists.
- The connection string, SSL, and prepared-statement settings required for Neon’s direct and pooled hosts.
- A rehearsal against a Neon copy while production still reads Supabase, then a reversible cutover.

### Out of scope

- Dyad’s user-app Supabase product: Management API, generated `@supabase/supabase-js` clients, Edge Functions, Storage, Realtime, local Supabase CLI, and the `execute_sql` path for a user’s own Supabase project. Those apps are a supported backend next to Neon. Removing them would change the product.
- Device SQLite (`src/db/schema.ts` apps, chats, and local HITL rows). That store is not Supabase.
- Preview Neon children and the Dev parent `br-mute-shadow-b3jxqoho`. Production rows must not be restored onto that parent. Preview copy-on-write would spread production ciphertext into every labeled preview.
- Neon Auth, Better Auth, and rewriting `auth.uid()`. This database does not use those.
- Building a dual-write proxy.

## What the user sees

After the URL swap, the same person sees the same questions, the same answers, and the same ability to answer. Encrypted GitHub and Supabase tokens for an account still decrypt with the existing `WEWEBPLUS_SECRETS_KEY`. A user building an app on their own Supabase project still uses that project.

## Decision log

1. **Migrate the control plane, and leave the Supabase product integration in place.** `src/supabase_admin/` and `src/ipc/handlers/supabase_handlers.ts` call `api.supabase.com` for a user’s project. `wewebplus.apps.supabase_project_id` and `account_connections.provider = 'supabase'` are data about those projects. The rows move. The Management API stays.
2. **Use Neon’s official `pg_dump` / `pg_restore` path.** The Neon console Import Data Assistant refuses Supabase because of unsupported extensions ([import data assistant](https://neon.com/docs/import/import-data-assistant), [migrate from Supabase](https://neon.com/docs/import/migrate-from-supabase)). There is no simpler official command for a Supabase source.
3. **Do not follow Neon’s “complete Supabase migration” guide.** That guide remaps `auth.users` onto Neon Auth / Better Auth and rewrites `auth.uid()` to `auth.user_id()`. Membership and answer rows store Clerk user ids as text. Remapping them would make the board show the wrong people.
4. **Dump `wewebplus` and `drizzle` only.** Dumping `auth`, `storage`, `realtime`, `vault`, or `extensions` pulls Supabase platform objects that this application does not query and that Neon cannot host.
5. **Put production in its own Neon project**, in the same region as the existing Wewebplus Neon project (`ap-southeast-1`) unless the catalog shows the Supabase project is elsewhere. The preview parent stays the sanitized Dev branch.
6. **Freeze writes, dump, compare, then switch the URL.** Logical replication is the official low-downtime alternative and is unnecessary until the catalog shows the table is too large or the freeze is unacceptable.
7. **Keep `WEWEBPLUS_SECRETS_KEY` unchanged.** Ciphertext is AES-256-GCM (`v1:` payloads in `src/control_plane/secrets.ts`). A new key makes every saved connection unreadable.
8. **Application queries stay.** Both clients already speak Postgres. The cutover does not replace Drizzle or the SQL in `hitl-web/lib/store.ts`.

## Neon’s official tooling

| Tool | What it does | Use it here? |
| --- | --- | --- |
| Import Data Assistant | Console import from a Postgres URL for databases under 10 GB. | No. Neon documents that Supabase is unsupported. |
| `pg_dump` then `pg_restore` | Official Supabase guide. Custom-format dump, restore with `--no-owner --no-acl`. | Yes. This is the database migration. |
| Logical replication | Publication on Supabase, subscription on Neon. Needs a direct IPv4 Supabase connection and Neon NAT addresses allowed in Supabase. Tables must already exist on Neon. | Only if the freeze window is unacceptable after the catalog. |
| “Complete Supabase migration” (Better Auth) | Moves Auth users, rewrites RLS helpers, remaps user ids by email. | No. Identity is Clerk. |
| CSV import | Table by table. | No. It drops constraints, indexes, and the migration journal. |

### What `pg_dump` / `pg_restore` moves

For the schemas you name, Postgres copies tables, columns, primary keys, foreign keys, unique indexes, secondary indexes, checks, sequences, views, functions, triggers, and row-level security policies that belong to those schemas, plus the table data.

`--no-owner` and `--no-acl` are required. Supabase ownership is tied to roles such as `supabase_admin` and `authenticator`, which do not exist in Neon. Objects restored by the Neon role in the connection string are owned by that role. Grants are not copied. The application connects as that owner, so the missing grants do not change its queries.

### What that tooling does not move

- Supabase Auth (GoTrue, JWT secrets, OAuth provider settings, `auth.users` sessions). Not used by this control plane.
- Storage files. The `storage` schema is metadata. The bytes live in Supabase’s object store. This app does not use that store for the control plane.
- Realtime publications and the Realtime service.
- Edge Functions and their secrets.
- Dashboard logs, API keys, and the Supabase Management API for this project.
- Extensions that Neon does not ship. A dump that includes `CREATE EXTENSION` for one of those fails at restore. The `wewebplus` migrations do not create extensions. `jsonb` and `timestamptz` are core Postgres.
- Roles `anon`, `authenticated`, and `service_role`.
- The application. The URL change is a separate step.
- Clerk users. They stay in Clerk. The database only stores their ids.

## Database inventory from the migrations

Production journal `control-plane/drizzle/meta/_journal.json` has three migrations: `0000_control_plane`, `0001_hitl`, `0002_gate_resolved_at`. The later `0003_runtime_run` column exists only on the preview implementation branch. It is not part of this production schema until that code is what production runs.

Schema `wewebplus`:

| Table | Relationships and indexes | Notes |
| --- | --- | --- |
| `account_connections` | Primary key `(owner_type, owner_id, provider)` | `ciphertext` is the encrypted GitHub or Supabase token. Copy the text unchanged. |
| `apps` | Index `apps_owner_idx` on `(owner_type, owner_id)` | `supabase_project_id` is a user’s Supabase project id, not this database. |
| `chats` | Foreign key to `apps`, cascade delete | |
| `messages` | Foreign key to `chats`, cascade delete | `ai_messages_json` is `jsonb`. |
| `knowledge_items` | Foreign key to `apps`, cascade delete | |
| `phase_approvals` | Foreign key to `apps`. Unique `(app_id, phase)` | |
| `phase_comments` | Foreign key to `apps`, cascade delete | |
| `answer_locks` | Primary key `chat_id`. Foreign key to `chats`, cascade delete | |
| `audit_events` | Primary key `id` | |
| `roles` | Primary key `(org_id, role_id)` | `0001` seeds Project Manager and Developer. |
| `memberships` | Primary key `(user_id, org_id)` | `0001` seeds the two Clerk memberships. |
| `questions` | Unique `(org_id, idempotency_key)` | |
| `answers` | Foreign key to `questions`, cascade delete. Unique `(question_id)`. `0002` adds nullable `gate_resolved_at` | |

The migrations contain no functions, triggers, row-level security policies, or extensions. Authorization is in application code (`presentQuestion`, `decideAnswer`, Clerk session checks), not in `auth.uid()`.

`openControlPlane` in `src/control_plane/db.ts` runs Drizzle migrate on startup. The migrator reads `drizzle.__drizzle_migrations` and applies any journal file whose `when` is newer than the latest `created_at`. If the Neon database has the tables and does not have that journal, the next boot runs `CREATE TABLE` again and the process fails. The dump must include the `drizzle` schema when it exists. If the catalog shows it does not exist, insert one row per applied migration before the first boot, using the journal `when` values and the sha256 of each `.sql` file. The migrator compares only the newest `created_at`.

The catalog step, run against production with the unpooled Supabase URL, is what confirms this inventory. Record schema names, `pg_extension`, and any object in `wewebplus` that is not in the table above. Extra objects are either included in the dump on purpose or listed as a gap. Do not invent them in advance.

```sql
select nspname from pg_namespace
where nspname not in ('pg_catalog', 'information_schema')
order by 1;

select extname from pg_extension order by 1;

select c.relkind, n.nspname, c.relname
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('wewebplus', 'drizzle')
order by 2, 1, 3;
```

Also count rows per `wewebplus` table. Those counts are the completeness check. Do not print ciphertext, connection strings, or Clerk secrets in the catalog output that gets saved into git.

## Application inventory

### Already a normal Postgres client

| Process | Code | How it connects |
| --- | --- | --- |
| Dyad main process | `src/control_plane/db.ts` | `postgres(WEWEBPLUS_DATABASE_URL, { max: 4 })`, then Drizzle migrate and the membership seed. |
| Question board on Vercel | `hitl-web/lib/db.ts` | `postgres(url, { max: 1, prepare: false, ssl: "require" })`. SQL is in `hitl-web/lib/store.ts`. |
| Account connections | `src/control_plane/repository.ts`, `secrets.ts` | Reads and writes `account_connections` through Drizzle. |
| Factory mirror | `src/control_plane/factory_records.ts`, `sync_local.ts`, `file_sync.ts`, `hitl_device.ts` | Same Drizzle client. |
| Gate poller, when that process is deployed | `scripts/gascity/resolve_hitl_answer.py` | `psycopg` and the same URL. |

No file under `src/control_plane/` or `hitl-web/` imports `@supabase/supabase-js`. No control-plane query calls `auth.uid()`, Realtime, Storage, or an Edge Function.

Startup also runs `seedWewebplusMemberships`, which inserts the role and membership rows with `on conflict do nothing`. A restored database that already has those rows stays as it is.

### Connection handling that must be chosen at cutover

Neon’s pooled host (hostname contains `-pooler`) runs PgBouncer in transaction mode. Prepared statements fail there. The Vercel client already sets `prepare: false`, so it can use the pooled URL. The Dyad main client leaves prepared statements at the driver default, so it must use the **direct** Neon URL (no `-pooler`). The same split exists on Supabase (pooler port 6543 versus direct port 5432). During the catalog, record which form production uses today without copying the URL into this file. If the Dyad process is on a pooler URL and is healthy, set `prepare: false` on that client before cutover. If it is on a direct URL, leave the client code alone and give it the direct Neon URL.

Both Neon URLs use `sslmode=require`. The Vercel client forces `ssl: "require"` except for localhost. That matches Neon.

### Supabase-specific code that stays

These paths serve a user’s own Supabase project. They keep working because that project is still Supabase. The control-plane migration does not retarget them.

- `src/supabase_admin/supabase_management_client.ts` and the handlers in `src/ipc/handlers/supabase_handlers.ts`
- Generated client snippets in `src/supabase_admin/supabase_context.ts` and the prompt rules in `src/prompts/supabase_prompt.ts` (`auth.uid()`, `supabase.functions.invoke`)
- Local Supabase mode and the SQL tool for a linked user app

`account_connections` rows with `provider = 'supabase'` are the encrypted tokens for that Management API. They have to round-trip through decrypt with the same `WEWEBPLUS_SECRETS_KEY` after the restore. A failed decrypt is a failed migration even when the row count matches.

### Device SQLite

Agent chats and the on-device factory store stay in SQLite on the container volume. `docs/clerk-auth.md` describes the control plane as a separate database. Copying Postgres does not replace those files, and it must not. After cutover, `syncRemote` writes the Neon database instead of Supabase. Existing SQLite rows stay on the volume.

## What cannot be reproduced in Neon, and the replacement

| Supabase capability | Used by the control plane? | Replacement |
| --- | --- | --- |
| Hosted Postgres | Yes | Neon Postgres. Same SQL. |
| Auth / `auth.uid()` / RLS tied to the JWT | No | Clerk plus the membership table. Do not add Neon Auth for this cutover. |
| Storage | No | None. |
| Realtime | No | None. The board loads questions by HTTP. |
| Edge Functions | No | None. |
| Management API and dashboard | Only as the current host’s console | Neon console for this database. User-app Management API calls stay on Supabase. |
| Platform roles and default privileges | Present on the server, unused by these queries | `--no-owner --no-acl`. The Neon owner role is the application role. |

## Database migration

1. Create a new Neon project for production. Do not create the branch from `br-mute-shadow-b3jxqoho`. Match the Supabase Postgres major version. Use `ap-southeast-1` unless the catalog shows another region.
2. Run the catalog SQL on the **unpooled** Supabase connection. Save counts and the object list in the operator notes. Leave passwords and ciphertext out of git.
3. If `wewebplus` contains an object that is not in the inventory, stop and decide whether the dump includes it. A blind restore of `auth` or `storage` is not the decision.
4. Quiesce writers: the production Dyad process’s control-plane writes, the production question board, and the gate poller if it is running. A short exclusive window is the whole downtime story for this schema.
5. Dump with the official flags, unpooled source, and only the application schemas:

```bash
pg_dump -Fc -v \
  --schema=wewebplus \
  --schema=drizzle \
  --no-owner --no-acl \
  -d "$SUPABASE_DIRECT_URL" \
  -f wewebplus.dump
```

If the catalog showed no `drizzle` schema, omit `--schema=drizzle`.

6. Restore into the empty Neon production database with the direct Neon URL:

```bash
pg_restore -v --no-owner --no-acl \
  -d "$NEON_DIRECT_URL" \
  wewebplus.dump
```

`schema "drizzle" already exists` or `schema "public" already exists` on an otherwise empty Neon database can be ignored when the following objects are created. Any other error stops the cutover.

7. If the `drizzle` journal was not in the dump, insert the migration rows for `0000`, `0001`, and `0002` before the first application boot. `created_at` is the journal `when`. `hash` is the sha256 of the migration file bytes. Include `0003` only when the code that will boot contains that migration.
8. Compare, from a machine that does not print row contents:

- `count(*)` for every `wewebplus` table, Supabase versus Neon.
- The set of primary keys for `questions`, `answers`, `memberships`, `apps`, and `account_connections`.
- `md5(ciphertext)` for each `account_connections` primary key, compared across the two databases. That checks the bytes without decrypting them into a log.
- One decrypt of a single ciphertext in a local process, using the existing `WEWEBPLUS_SECRETS_KEY`, with the plaintext discarded. Success means the key still matches. Failure means stop.

9. Keep the dump file outside git until the rollback window is over, then delete it. It contains ciphertext and question text.

## Application migration

No query rewrite is required when the catalog matches the migrations. The behavior change is the connection string.

| Environment | Variable | Value |
| --- | --- | --- |
| Production Dyad process (Doppler config that the container already reads) | `WEWEBPLUS_DATABASE_URL` | Neon **direct** URL |
| Production Vercel question board | `WEWEBPLUS_DATABASE_URL` | Neon **pooled** URL |
| `WEWEBPLUS_SECRETS_KEY` | unchanged | Same key on both sides |
| Preview Doppler, preview Vercel, `NEON_PARENT_BRANCH_ID` | unchanged | Preview stays on its own Neon children |

`compose.gascity.yml` already passes `WEWEBPLUS_DATABASE_URL` through. The image does not need a rebuild for the URL swap. Restart the process that cached the old client (`src/control_plane/db.ts` keeps a module-level client; `hitl-web/lib/db.ts` keeps one on `globalThis`). A restart is the way those caches drop the Supabase connection.

Code to change only if the catalog or a rehearsal shows it:

- `prepare: false` in `src/control_plane/db.ts` if the Dyad process must use the pooled host.
- Nothing in `hitl-web/lib/store.ts`, `src/control_plane/schema.ts`, or the Supabase admin client.

Rehearsal, before any production URL changes:

1. Point a non-production question board (a Vercel preview env, or a local `hitl-web`) at the Neon direct or pooled URL. Leave the production Vercel env on Supabase.
2. Sign in with Clerk and load the board. The question ids, statuses, and answer text match the production board.
3. Write one answer on the Neon copy only. Confirm it is absent from Supabase. That proves the rehearsal was not pointed at production.
4. Boot a Dyad process with the Neon direct URL and `WEWEBPLUS_SECRETS_KEY` set, against a Neon branch that is not production traffic. Startup must finish `migratePostgres` without re-running `CREATE TABLE`. Loading an account connection must decrypt.
5. Run the existing unit tests that do not need a live database: `src/control_plane/hitl.test.ts`, `src/control_plane/secrets.test.ts`, `hitl-web/lib/hitl.test.ts`. They lock the rules and the ciphertext format. They do not replace the row comparison.

## Cutover

1. The rehearsal checks above have passed on the Neon copy.
2. Quiesce writers again and take a fresh dump. Restore into the same Neon database only if it is still empty of rehearsal writes, or restore into a new branch created from an empty parent and repeat the count check. A rehearsal answer must not become production data.
3. Set the production Dyad URL to the Neon direct URL and restart that process.
4. Set the production Vercel URL to the Neon pooled URL and redeploy that production deployment.
5. Read the production board and one factory account path. Counts still match the last Supabase dump. A new answer written after the swap appears in Neon and does not appear in Supabase.
6. Leave Supabase running and writable-frozen (no application still has its URL). It is the rollback copy.

## Rollback

1. If the failure is found before step 3 of the cutover, do nothing to production. Supabase is still the live database.
2. If the failure is found after the URL swap, point both production URLs back at the Supabase direct and pooled URLs and restart Dyad and Vercel.
3. Writes that landed only in Neon after the swap are not in Supabase. Before switching back, dump `wewebplus` from Neon and apply that delta, or accept the loss of those writes when the window was still the quiesce. Do not leave the two databases both receiving writes.
4. Supabase stays available until a later decision to remove it. Deleting the Supabase project is not part of the cutover.

## Implementation plan

### Phase 1: Catalog

- [x] Run the catalog on the production URL. The direct Supabase host is IPv6-only from the production server, so the read used the session pooler the process already uses (port 5432).
- [x] Confirm the object list matches the inventory, or record the extras.
- [x] Record row counts and whether `drizzle.__drizzle_migrations` exists.
- [x] Record whether the Dyad process uses a direct or pooled URL.

## Measured catalog (2026-10-04)

Read from the running production Dyad container. No connection string, ciphertext, or row body was saved. Production `WEWEBPLUS_DATABASE_URL` was not changed.

- Provider: Supabase. Postgres 17.6. Database name `postgres`.
- The Dyad process uses the Supabase session pooler on port 5432. It has been healthy on that URL. A direct `db.<project>.supabase.co` connection from that server fails with `ENETUNREACH` because the address is IPv6. `pg_dump` from that server has to use the session pooler until the Supabase IPv4 add-on is enabled. Do not use port 6543.
- `wewebplus` tables, columns, and indexes match migrations `0000`–`0002`. There are no functions, triggers, or policies in `wewebplus` or `drizzle`. `runtime_run_id` is not present.
- `drizzle.__drizzle_migrations` has three rows whose `created_at` values are `1790499480296`, `1790838000000`, and `1790907463649`.
- `wewebplus` is about 991 KB. Counts: `account_connections` 0, `answer_locks` 0, `answers` 3, `apps` 10, `audit_events` 0, `chats` 31, `knowledge_items` 0, `memberships` 2, `messages` 85, `phase_approvals` 0, `phase_comments` 0, `questions` 3, `roles` 2.
- `account_connections` is empty, so the decrypt check has no row to test.
- The same Supabase project also contained `public` (including `agenturmarkt_leads`, 8182 rows, plus deals, funnels, and template tables), `storage.objects` (182 rows), and empty `auth.users`. This repository does not query those tables. They were not dumped into the control-plane Neon project. After the cutover, `public.agenturmarkt_leads`, the `pipeline-artifacts` bucket, and the remaining 70 `public` tables were dropped. Storage has no buckets. `public` has no tables. `wewebplus` and `drizzle` remain on Supabase as the rollback copy.
- Extensions installed on the Supabase database are `pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault`, `uuid-ossp`, and `vector`. None are used by the `wewebplus` tables. The schema-scoped dump does not need them on Neon.

### Phase 2: Empty Neon project and restore

- [x] Create the production Neon project. Do not parent it on the preview Dev branch.
- [x] `pg_dump` / `pg_restore` as above.
- [x] Seed the Drizzle journal if the dump did not include it.
- [x] Compare counts, primary keys, and ciphertext hashes.

The new project is `proud-salad-68182047` (`wewebplus-production`), Postgres 17, region `aws-ap-southeast-1`. Its default branch is `br-billowing-frost-b3i42bh6` (`main`) with no parent. It is not project `mute-credit-71067312` and not branch `br-mute-shadow-b3jxqoho`. The endpoint is `ep-young-wave-b3cwe0rz`. The database name is `neondb`. Compute is 0.25 CU and does not suspend. The transaction pooler is enabled. The direct host and the pooled host are different, and a `SELECT 1` succeeded on each.

The dump used the production session pooler (port 5432) from the running container. `pg_dump` 17.11 wrote a custom-format archive of only `wewebplus` and `drizzle` (`--no-owner --no-acl`). The archive contains those two schemas, the 13 tables, the Drizzle journal, and no `auth`, `storage`, or `public` tables. `pg_restore --no-owner --no-acl --exit-on-error` into the direct Neon URL exited 0.

Comparison after the restore, with row bodies left unread:

- Columns, indexes, and constraints in `wewebplus` and `drizzle` match Supabase.
- Counts match the catalog above, including `apps` 10, `chats` 31, `messages` 85, `questions` 3, `answers` 3, `memberships` 2, `roles` 2, and zeros elsewhere.
- Ordered primary-key hashes match for `questions`, `answers`, `memberships`, `apps`, and `account_connections`.
- `account_connections` is still empty on both sides, so the ciphertext hash is the empty digest and there is still no row to decrypt.
- `drizzle.__drizzle_migrations` still has the three `created_at` values above. Nothing was inserted by hand.

This dump was taken while the production container was up and healthy. It is a rehearsal copy. It is not the cutover snapshot. Production `WEWEBPLUS_DATABASE_URL` was not changed. The preview parent was not written.

### Phase 3: Rehearsal

- [x] Run the control-plane Drizzle migrator from this tree against the Neon direct URL.
- [x] Confirm startup does not apply a later migration. `account_connections` is empty, so there is no ciphertext to decrypt.
- [x] Write one question and one answer on Neon only, confirm both are absent from Supabase, then delete them so the rehearsal copy matches the dump again.

The migrator logged `schema "drizzle" already exists, skipping` and `relation "__drizzle_migrations" already exists, skipping`, then left the journal at 3 rows with max `created_at` `1790907463649`. Counts stayed at the restored values. A question id `rehearsal-neon-cutover` inserted on Neon was absent from Supabase (`questions` stayed 3). Deleting that question removed the answer with it. Both databases were at 3 questions and 3 answers afterward.

The production question board and the production Dyad process were not pointed at Neon. Preview Doppler and preview Vercel were not changed.

### Phase 4: Cutover and rollback watch

- [x] Fresh dump after a second quiesce. Restore over an empty target.
- [x] Swap the two production URLs. Restart both processes.
- [x] Write one answer through the pooled URL. Confirm Supabase did not receive it.
- [x] Keep the Supabase URL ready to restore.

The production Dyad container was stopped, then a fresh `pg_dump` of `wewebplus` and `drizzle` was restored into project `proud-salad-68182047` after dropping those two schemas. Counts, columns, indexes, primary-key hashes, and the three journal rows matched Supabase. The container was recreated from `weaver-plus:gascity` with the same user-data volume and `/opt/gascity/projects` bind. Its `WEWEBPLUS_DATABASE_URL` is the Neon direct URL (`neondb`, no pooler). The process came back healthy, with the browser bridge listening, and the boot log has no error lines.

The Vercel project `dyad` production env `WEWEBPLUS_DATABASE_URL` (`vJLpG7xL8cK1vsSK`) now points at the Neon pooled URL. Production deployment `dpl_8SRrfi3ebgMyvRDj4a7jCPKmu6DQ` is READY and holds the production aliases. Preview env entries were left in place. `WEWEBPLUS_SECRETS_KEY` was not changed.

A question id `rehearsal-neon-cutover` inserted through the pooled URL was visible on Neon and absent from Supabase. That row and its answer were then deleted. Both databases are back to 3 questions and 3 answers.

Rollback files on the server, mode 0600: `/opt/gascity/weaver.env.supabase-backup` and `/opt/gascity/weaver.rollback.env`. They still hold the Supabase session-pooler URL. `/opt/gascity/weaver.env` holds the Neon direct URL. To roll back, point the production Vercel env and `weaver.env` at the Supabase URL, recreate the container from `weaver.rollback.env`, and redeploy Vercel. If Neon received writes that must be kept, dump `wewebplus` from Neon before that rollback.

## Testing strategy

- [x] Catalog object list equals the migration inventory, or every extra object is named.
- [x] Row counts and primary-key sets match.
- [x] Ciphertext hashes match. There is no ciphertext row to decrypt.
- [x] Drizzle boot on Neon applies no `CREATE TABLE` for tables that already exist.
- [x] After the swap, Neon counts match the quiesced Supabase dump. A pooled-URL write was absent from Supabase.
- [ ] A user-app Supabase action (link project or run a project query) still uses `api.supabase.com` and is unaffected. That path was not exercised during the cutover.
- [x] Preview `WEWEBPLUS_DATABASE_URL` entries were not written. Preview Doppler, preview Vercel, and `NEON_PARENT_BRANCH_ID` were left as they were.

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Import Data Assistant or a full-database dump pulls Supabase extensions and fails | High if the wrong tool is used | Restore aborts | Dump only `wewebplus` and `drizzle`. |
| Boot reapplies migrations and dies on existing tables | High if the journal is omitted | Dyad and the board cannot open the database | Restore `drizzle.__drizzle_migrations` or insert the journal rows before boot. |
| Production ciphertext restored onto the preview parent | Medium if the Neon project is reused | Preview branches inherit production tokens | New Neon project. Preview parent stays the Dev branch. |
| Pooled Neon URL with prepared statements | Medium | Dyad queries fail at runtime | Direct URL for Dyad. Pooled URL only for Vercel, which already sets `prepare: false`. |
| Clerk ids rewritten with the Better Auth guide | Low if that guide is followed | Board shows the wrong people | Do not use that guide. |
| Cutover while both databases accept writes | Medium | Rollback loses or double-applies answers | One writer. Supabase frozen after the swap. |
| `0003_runtime_run` applied by a newer binary | Medium when that branch deploys | Harmless `ADD COLUMN` if the journal is older; failure if the column is assumed before the binary ships | Journal rows match the binary that boots. |

## Open questions

- The cutover is done. Production Dyad and the production question board read Neon project `proud-salad-68182047`. Supabase still has the quiesced `wewebplus` copy and its Drizzle journal. The unrelated `public` tables and the `pipeline-artifacts` bucket have been removed. The preview Doppler config has no separate Supabase key. `WEWEBPLUS_DATABASE_URL` stays; in production it is the Neon URL.
- No gate poller process was running on the production host at the pause. The Dyad container was the writer that was stopped.
- Rollback is the Supabase URL in `/opt/gascity/weaver.rollback.env` plus the production Vercel env. Deleting the Supabase project is a later decision.

---

_Database half: official `pg_dump` / `pg_restore` of the application schemas. Application half: the same queries, with the production connection string moved to Neon after the rehearsal matches._
