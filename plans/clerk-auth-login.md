# Clerk sign-in UI + app-wide auth — implementation plan

Issue: [Awannaphasch2016/dyad#2](https://github.com/Awannaphasch2016/dyad/issues/2) — "wewebplus: Clerk sign-in UI and app-wide user authentication"

> **Secret hygiene (read first):** a Doppler service token was pasted in chat. Treat it as compromised: **rotate it in Doppler now**, never paste tokens in chat/issues, and never commit `.env`. Local dev gets keys via Doppler → `.env` (gitignored). Cloud Agents get them via Cursor Dashboard → Secrets, not via chat.

## 1. Goal

Give wewebplus a real Clerk login: embedded **Sign in / Sign up** UI in the renderer, session awareness in Electron **and** on the iPad Safari + Cloudflare tunnel, and route/role protection so factory work is tied to the signed-in Clerk user.

Non-goals for this plan: Supabase Auth, Clerk Organizations, per-app Clerk tenancy, syncing Dyad `apps` rows to Clerk user IDs.

## 2. Current state

| Area | What exists |
|---|---|
| Roles model | `src/lib/adminAccess.ts` — `admin` / `reviewer` / `dev`, `roleFromMetadata()` maps legacy `member` → `reviewer` |
| Admin UI | `src/pages/admin-access.tsx` on `/library` — Members \| Role table + Roles \| Permission table. No Sign in/Sign up links (removed). |
| Clerk main-process API | `src/ipc/handlers/clerk_handlers.ts` — `clerk:get-access`, `clerk:invite-member`, `clerk:set-member-role` using `CLERK_SECRET_KEY` (main-only). Registered in `src/ipc/ipc_host.ts`, allowlisted via contracts. |
| Contracts | `src/ipc/types/clerk.ts` — Zod schemas + `clerkContracts` / `clerkClient`. |
| Env | `.env.example` documents `CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY`. Runtime reads `process.env` directly in handlers. No publishable key reaches the renderer today. |
| Router | `src/router.ts` + `src/routes/*.ts` (TanStack Router). Root layout `src/routes/root.tsx` → `src/app/layout.tsx` (sidebar, `TitleBar`, providers). No auth routes, no `beforeLoad` guards. |
| Shell | `src/app/TitleBar.tsx` — logo left-aligned, no user menu. Sidebar `src/components/app-sidebar.tsx` — Apps + Admin. |
| Bridge | `/tmp/dyad-web-bridge.mjs` proxies the renderer on `:8372`; quick-tunnel hostnames expire and change. iPad Safari is the primary client. |

## 3. Key decisions

1. **Embedded Clerk components over Account Portal redirects.** Use `@clerk/clerk-react` `<SignIn/>`/`<SignUp/>` on `/sign-in`, `/sign-up`, themed to wewebplus. Redirects open a new tab and break the iPad flow; keep Account Portal only as a documented fallback if the Electron webview blocks embedded auth.
2. **Publishable key via IPC, not build-time env.** Add `clerk:get-publishable-key` (main reads `process.env.CLERK_PUBLISHABLE_KEY`, returns `{ publishableKey: string | null }`). Renderer bootstraps `ClerkProvider` from it. This avoids `VITE_CLERK_*` rebuild churn and keeps `CLERK_SECRET_KEY` main-only. Follow `rules/electron-ipc.md`: contract in `src/ipc/types/clerk.ts`, re-export in `src/ipc/types/index.ts`, handler with `createTypedHandler`, registration already exists for the domain.
3. **Session lives in the renderer via Clerk SDK.** No session-token IPC for routine auth. Main keeps trusting its own secret-key Admin API; renderer gates UI and passes Clerk user/role for display. Only if Admin mutations need server-side role checks later do we add a verified-session endpoint (Clerk `authenticateRequest` in main) — explicitly out of v1.
4. **Organizations stay off.** Single user pool; `public_metadata.role` remains the role source, read via `useUser()` → `roleFromMetadata()`.
5. **Default-deny on factory + Admin, open home.** Proposal: `/`, `/sign-in`, `/sign-up` public; `/chat`, `/apps`, `/app-details`, `/library` (Admin) require sign-in; Admin mutations additionally require `admin`. Confirm with product before implementing guards.

## 4. Changes by area

### 4.1 Dependencies + provider bootstrap

- Add `@clerk/clerk-react` (check React 19 / Vite 5 peer compatibility first; pin version).
- New `src/auth/clerkProvider.tsx`: fetches publishable key via IPC (`useQuery`, `queryKeys` factory), renders `<ClerkProvider publishableKey>`; on missing key renders a "login not configured" fallback that preserves current un-gated behavior (dev without keys keeps working).
- Mount provider at the narrowest point that covers guarded routes: `src/routes/root.tsx` or `src/app/layout.tsx`. Keep PostHog/Query providers untouched in `src/renderer.tsx`.

### 4.2 IPC (one new read-only endpoint)

- `src/ipc/types/clerk.ts`: `getPublishableKey: defineContract({ channel: "clerk:get-publishable-key", input: z.void(), output: z.object({ publishableKey: z.string().nullable() }) })`.
- `src/ipc/handlers/clerk_handlers.ts`: handler returns `process.env.CLERK_PUBLISHABLE_KEY ?? null`. No secret leaves main. Classify errors per `rules/dyad-errors.md` (missing key is a precondition, not a bug).
- Preload allowlist is auto-derived; add coverage in `channels.test.ts` per `rules/electron-ipc.md`.

### 4.3 Routes + guards (TanStack Router)

- New `src/routes/sign-in.tsx`, `src/routes/sign-up.tsx` rendering themed Clerk components with `afterSignInUrl`/`afterSignUpUrl` back to `/` or the originally requested route.
- Register in `src/router.ts` route tree.
- Add `beforeLoad` guards (or a shared `requireAuth` helper) on protected routes: redirect unauthenticated → `/sign-in?redirect_url=...`. Clerk's `<SignedIn>/<SignedOut>` or `useAuth().isLoaded/isSignedIn` drives the check; handle the loading state to avoid flashing protected content.
- Keep `NotFoundRedirect` behavior unchanged.

### 4.4 Session UI (Base UI, not Radix)

- Title bar or sidebar footer: `<SignedIn>` shows Clerk `<UserButton/>` (or custom avatar + email + Sign out) — pick one home, not the Admin header. `<SignedOut>` shows Sign in link. Follow `rules/base-ui-components.md` for any custom menu/popover.
- Factory composer/preview chrome unchanged except role-gated approve controls (see 4.5).

### 4.5 Role enforcement

- New `src/auth/useClerkRole.ts`: `useUser()` → `publicMetadata.role` → `roleFromMetadata()` → `{ roleId, role }`. Default while loading: most restrictive rendering (hide approve buttons) to avoid flashing privileged actions.
- Gate: approve Discovery/Implementation/Delivery buttons by role permissions from `ADMIN_ROLES`; Admin invite/role-change controls require `admin`. Renderer gating is UX; note in code that true authorization for Admin mutations is a future server-side step.
- Reuse existing unit tests in `src/lib/adminAccess.test.ts`; add tests for the new hook with a mocked Clerk provider.

### 4.5a Out of scope (explicitly deferred)

- Server-side verification of the Clerk session in main (would need `authenticateRequest` + session token transport).
- Filtering/auditing Dyad `apps` by Clerk user ID.
- Organizations / org switcher.

## 5. Safari + tunnel + Electron notes

- **Clerk dashboard:** allowlist the tunnel host(s) as needed (quick-tunnel hosts rotate — document that auth testing must not depend on a fixed hostname; use the current host each session).
- **Safari ITP / third-party cookies:** Clerk dev-browser mode and cross-site cookies are the main risk on iPad Safari. Test sign-in, reload persistence, and sign-out on the real tunnel URL, not just `localhost`. Record required Clerk settings (allowed origins, dev browser / production keys) in the plan's test notes.
- **Electron persistence:** verify session survives window reload and app restart (partition storage). If the product window uses a custom partition, confirm Clerk storage works there.
- **Bridge:** no auth logic in `dyad-web-bridge.mjs`; it stays a dumb proxy. Cookie behavior is between Safari and Clerk.

## 6. Env / secrets wiring

- Local: Doppler holds `CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY`; dev runs with them in `.env` (gitignored) or `doppler run`. Never log key values.
- Cloud Agent / CI: add both keys in Cursor Dashboard → Secrets (repo-scoped if available). The pasted `dp.st...` token must be rotated and must not be stored anywhere in the repo.

## 7. Implementation steps

1. **Spike (no UI):** install `@clerk/clerk-react`, confirm version compat; prototype `ClerkProvider` with a hardcoded dev key in a scratch branch; verify Electron + tunnel load. Throw away or gate before merging.
2. **IPC:** add `clerk:get-publishable-key` contract + handler + preload test.
3. **Provider:** add `src/auth/clerkProvider.tsx`, mount in root layout, missing-key fallback.
4. **Routes:** `/sign-in`, `/sign-up` pages + router registration, themed to wewebplus.
5. **Session UI:** user menu / sign-out placement; remove nothing else.
6. **Guards:** `beforeLoad` on `/chat`, `/apps`, `/app-details`, `/library`; redirect with return URL.
7. **Roles:** `useClerkRole`, gate approve + Admin mutation UI; loading-state defaults.
8. **Tests:** unit (role hook, guards helper), IPC harness test for the new endpoint, renderer+IPC integration per `rules/hybrid-testing.md` where valuable.
9. **Manual matrix:** Electron dev, packaged build, iPad Safari via current tunnel (sign-in, reload, sign-out, unauthenticated redirect, non-admin Admin view).
10. **Docs:** update `.env.example` notes only if the flow changes; add a short `docs/clerk-auth.md` or section in the issue with dashboard + Doppler setup and tunnel caveats.

## 8. Testing approach

- `npm test -- src/auth/... src/ipc/handlers/clerk_handlers.test.ts` (new harness test for `get-publishable-key`, mocked env).
- Existing `src/lib/adminAccess.test.ts`, `src/pages/admin-access.test.tsx` keep passing; extend for role gating.
- `npm run lint`, `npm run fmt`, `npm run ts` before commit (per AGENTS.md).
- Manual iPad pass is required — Vitest cannot cover Safari cookies or tunnel DNS. Record the tunnel host used.

## 9. Risks

- Clerk React version vs. React 19/Vite 5 peers.
- Safari third-party-cookie / dev-browser friction on rotating tunnel hosts.
- Route-guard flashing privileged UI before `isLoaded` — mitigate with restrictive loading defaults.
- Scope creep into server-side authorization — deliberately deferred; renderer gates are UX-only in v1.

## 10. Acceptance criteria

- [ ] Sign in / Sign up works in Electron and on iPad Safari via tunnel; session persists across reload.
- [ ] Unauthenticated visits to `/chat` and `/library` redirect to sign-in and return after login.
- [ ] Signed-in non-admin cannot see/use Admin invite + role-change controls; admin can.
- [ ] No secret key in any client bundle; `CLERK_SECRET_KEY` only referenced in main.
- [ ] Missing keys degrade to the documented fallback instead of a blank page.
- [ ] Unit + IPC tests added; lint/fmt/ts clean.

## 11. Open questions for the user

1. Confirm default-deny set: which routes (if any) stay public besides home/sign-in/sign-up?
2. Should a signed-in non-admin see the Admin page read-only, or be blocked entirely?
3. Custom Clerk styling depth: match wewebplus exactly, or ship Clerk defaults first?
