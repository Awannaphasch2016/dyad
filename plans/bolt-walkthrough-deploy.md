# Deploy the bolt walkthrough

The walkthrough is on [bolt.diy pull request 2](https://github.com/Awannaphasch2016/bolt.diy/pull/2). There is no public address yet. This plan publishes a preview address for that pull request. Production stays closed.

## Environments

1. **Local.** `docker compose --profile development up` on the pull request branch. Address: `http://localhost:5173`. Chat history stays in that browser. No database branch.
2. **Preview.** Bolt’s own Preview Deployment workflow builds the pull request and deploys it to Cloudflare Workers. The address is the preview URL that workflow writes on the pull request. Chat history still stays in the browser. No Neon branch, no Dyad preview host.
3. **Production.** Later. The `app-prod` container, or the Cloudflare Worker named `bolt`, only after the preview walkthrough is accepted. Not this plan.

## Flow

```text
pull request branch
  -> Cloudflare Workers preview
  -> you open the preview URL and walk Discovery, Implementation, Delivery
  -> only then production
```

## What this deploy is not

- `pr-<n>.anakwannaphaschaiyong.com` is the Dyad and Gas City preview. Bolt does not run there.
- The Vercel project is the Dyad browser UI. Bolt’s preview workflow does not use it.
- `main` on bolt.diy is not deployed.

## Why this host

Bolt already has the preview job in `.github/workflows/preview.yaml`. It deploys with Wrangler when the bolt repository has `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. On pull request 2 that job passed and wrote “Preview deployment not configured”, because those two secrets are absent. Adding them is the whole deploy.

The page needs the Worker (or the local Docker server). The chat runs in the browser through WebContainer, and that server is what bolt’s preview job already builds.

## Steps

1. Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repository secrets on `Awannaphasch2016/bolt.diy`. These are bolt secrets. They are not the Dyad `ai-bots` environment secrets.
2. Re-run **Preview Deployment** on pull request 2.
3. Open the preview URL in the new pull request comment.
4. In that browser, enter one model key in bolt’s settings. The preview does not ship a key.
5. Walk Discovery, Implementation, and Delivery. Reload the page and confirm the phase and the messages are still there.

## Done when

The pull request comment contains a real `https` preview URL, and that URL still shows the walkthrough phase after a reload.
