# Bolt as the website, from dev to production

1. The website is [Awannaphasch2016/bolt.diy](https://github.com/Awannaphasch2016/bolt.diy). It is still an exact copy of upstream. Dyad stays a desktop app and is not the public site.
2. Build only the walkthrough already used in Dyad: one chat, one send at a time, then Discovery, Implementation, and Delivery.
3. A phase stays locked until the last reply has that phase’s summary heading and bullets. Approve continues. Implementation shows the page in the preview.
4. Leave out the Electron bridge, the Cloudflare socket, the Namespace tunnel, and bolt’s extra panels (deploy, Supabase, MCP, speech, templates).
5. Dev is `docker compose --profile development up` on port 5173. Production is the `app-prod` profile of the same commit. The model key lives only in the server environment.
6. Production is ready when the Bartel walkthrough finishes on that container, and a reload still shows the phase and the messages.
7. After that, bolt gets the three Gas City routes Dyad already serves: messages, approve, and runs. Gas City switches to bolt. The `pr-48` tunnel comes down.
