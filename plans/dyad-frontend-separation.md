# DYAD frontend on Vercel, GasCity in the middle

> Written 2026-10-03. The browser UI no longer needs Electron between it and GasCity.

## Current state

```mermaid
flowchart LR
  browser[Browser]
  electron[Electron main process]
  gascity[GasCity]
  browser -->|window.electron IPC or browser bridge| electron
  gascity -->|localhost host bridge, Origin rejected| electron
  hitl[Standalone Vercel HITL page] -->|Postgres| db[(wewebplus)]
  gascity --> db
```

The DYAD pages in `src/` call `window.electron`. The factory host bridge inside Electron rejects every request that carries an `Origin` header, so a Vercel page cannot call it. The standalone `hitl-web` page talked to Postgres directly and was a second frontend.

## Target state

```mermaid
flowchart LR
  ui[Vercel DYAD UI]
  gascity[GasCity browser API]
  electron[Electron runtime]
  ui -->|HTTPS /v1 runs, gates, capabilities| gascity
  gascity -->|only for a named machine capability| electron
```

Primary path:

```mermaid
sequenceDiagram
  participant UI as Vercel DYAD UI
  participant GC as GasCity
  participant HITL as Gate
  UI->>GC: POST /v1/runs prompt
  GC-->>UI: 202 accepted, electronInvoked false
  GC->>HITL: open the role gate
  UI->>GC: GET /v1/hitl/questions
  GC-->>UI: question body only for the matching role
  UI->>GC: POST /v1/hitl/questions/:id/answers
  GC-->>UI: answered, electronInvoked false
  GC->>GC: continue the workflow
```

Electron is a side path:

```mermaid
sequenceDiagram
  participant UI as Vercel DYAD UI
  participant GC as GasCity
  participant EL as Electron
  UI->>GC: POST /v1/capabilities/electron capability terminal
  GC-->>UI: 409 electron-required, electronInvoked false
  Note over GC,EL: GasCity calls Electron only after it decides the capability is required
  GC->>EL: host bridge on localhost
  EL-->>GC: local result
```

## Branch split

- `cursor/dyad-web-frontend-bbea` is this preview. It changes the Vercel app only. Root directory stays `hitl-web`, which is what the existing Vercel project builds, so this branch gets its own preview URL.
- `cursor/gascity-browser-api-bbea` is the GasCity HTTP listener. It allows listed browser origins, speaks the same `/v1` paths, and does not import Electron. It calls a host bridge only when one is configured.

Set `NEXT_PUBLIC_GAS_CITY_URL` to the GasCity origin when that listener is public. Until then the preview calls same-origin `/v1`, which uses the existing question store and never starts Electron.

## What left Electron

Clerk sign-in, the home composer, and HITL gates. Those now run in the browser and talk to GasCity.

## What stays in Electron

Terminal, local preview, filesystem, git, safe storage, native dialogs, and the other domains marked `electron` in `hitl-web/lib/boundary.ts`. They need the host machine. The web UI asks GasCity for them and stops. It does not open `window.electron`.
