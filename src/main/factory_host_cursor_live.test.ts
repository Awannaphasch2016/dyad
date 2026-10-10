/**
 * C2–C4. Skipped unless HITL_CURSOR_LIVE=1. The Actions job sets that after
 * Doppler injects CURSOR_API_KEY. The key stays in this process: the agent
 * request does not receive an env block.
 */
import type { AddressInfo } from "node:net";
import { request as httpRequest } from "node:http";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

vi.mock("node-pty", () => ({
  spawn: () => {
    throw new Error("node-pty is not used by the Cursor poller");
  },
}));
import type { HitlCaller } from "@/control_plane/hitl";
import { apps, chats, factoryHostRuns } from "@/db/schema";
import { classifyCursorFactoryStop } from "@/lib/cursorFactoryStop";
import { extractFactoryRequest } from "@/lib/factoryRequest";
import { factoryPhaseSystemPrompt } from "@/prompts/factory_phase_prompt";
import { createInMemoryTestDb } from "@/testing/test_db";
import { createFactoryHostBridgeServer } from "./factory_host_bridge_server";
import { recordCursorFactoryRun } from "./factory_host_service";

const ORG = "org_wewebplus";
const live = process.env.HITL_CURSOR_LIVE === "1";
const TERMINAL = new Set(["FINISHED", "ERROR", "CANCELLED", "EXPIRED"]);

const FIRST_PROMPT = `${factoryPhaseSystemPrompt("implementation")}

The approved Discovery summary is missing the page name. Do not invent a name, and do not build yet.
Ask the project-manager which name the page should use. Use the request format from the instructions above, then stop.
After a later message brings that answer, ask the developer which font the page should use, in a new request, then stop.
After a later message brings the font, write the implementation summary and stop.
This message is only the first step. Write the project-manager request and nothing after it.`;

const ANSWERS: Record<string, string> = {
  "project-manager": "Tiny Bakery",
  developer: "Use Source Serif for the headings.",
};

interface Attempt {
  n: number;
  runId: string;
  status: string;
  polls: number;
  marker: "present" | "absent";
  role: string | null;
  stop: string | null;
}

describe.skipIf(!live)("cursor factory poller", () => {
  it(
    "posts one project-manager question, then a developer question, then a summary",
    async () => {
      const key = process.env.CURSOR_API_KEY?.trim();
      if (!key) throw new Error("CURSOR_API_KEY is required");
      process.stdout.write(`::add-mask::${key}\n`);
      const redact = (value: unknown) => {
        const text = String(value ?? "")
          .split(key)
          .join("[redacted]");
        return text.slice(0, 180);
      };

      async function api(
        method: string,
        path: string,
        body?: unknown,
      ): Promise<{ status: number; json: any }> {
        const response = await fetch(`https://api.cursor.com${path}`, {
          method,
          headers: {
            Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`,
            Accept: "application/json",
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        const text = await response.text();
        let json: any = null;
        try {
          json = JSON.parse(text);
        } catch {
          json = { message: text };
        }
        return { status: response.status, json };
      }

      async function followUp(agentId: string, prompt: string) {
        let last = "";
        for (let attempt = 0; attempt < 6; attempt++) {
          const result = await api("POST", `/v1/agents/${agentId}/runs`, {
            mode: "plan",
            prompt: { text: prompt },
          });
          const runId = result.json?.run?.id;
          if (
            (result.status === 200 || result.status === 201) &&
            typeof runId === "string"
          ) {
            return runId as string;
          }
          last = redact(
            result.json?.message ??
              result.json?.error?.message ??
              result.status,
          );
          if (result.status !== 409) break;
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
        throw new Error(`follow-up failed: ${last}`);
      }

      async function waitForRun(agentId: string, runId: string) {
        const started = Date.now();
        let polls = 0;
        let last: any = null;
        while (Date.now() - started < 10 * 60 * 1000) {
          polls += 1;
          const result = await api(
            "GET",
            `/v1/agents/${agentId}/runs/${runId}`,
          );
          if (result.status !== 200) {
            throw new Error(`poll failed: ${redact(result.json?.message)}`);
          }
          last = result.json;
          const status = String(last?.status ?? "");
          if (TERMINAL.has(status)) {
            const message =
              typeof last?.result === "string" ? last.result : null;
            return { status, message, polls, fields: Object.keys(last ?? {}) };
          }
          await new Promise((resolve) => setTimeout(resolve, 10000));
        }
        throw new Error("poll timed out");
      }

      const database = createInMemoryTestDb();
      const appId = Number(
        database.insert(apps).values({ name: "Factory", path: "factory" }).run()
          .lastInsertRowid,
      );
      database
        .update(apps)
        .set({ ownerType: "org", ownerId: ORG })
        .where(eq(apps.id, appId))
        .run();
      for (const title of ["Discovery", "Implementation", "Delivery"]) {
        database.insert(chats).values({ appId, title }).run();
      }
      const callers = new Map<string, HitlCaller>([
        [
          "pm",
          {
            orgId: ORG,
            userId: "user_pm",
            roleId: "project-manager",
            displayName: "PM",
          },
        ],
        [
          "dev",
          {
            orgId: ORG,
            userId: "user_dev",
            roleId: "developer",
            displayName: "Dev",
          },
        ],
      ]);
      const server = createFactoryHostBridgeServer({
        token: "machine-token",
        database,
        resolveCaller: async (token) => callers.get(token) ?? null,
        dispatchChatIntent: async () => {
          throw new Error("local chat must not start");
        },
        cursorFollowUp: async (input) => ({
          cursorRunId: await followUp(input.cursorAgentId, input.prompt),
        }),
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const address = server.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const request = (
        path: string,
        init: { method?: string; body?: unknown } = {},
        token = "machine-token",
      ) =>
        new Promise<{ status: number; body: any }>((resolve, reject) => {
          const payload =
            init.body === undefined ? undefined : JSON.stringify(init.body);
          const http = httpRequest(
            `${baseUrl}${path}`,
            {
              method: init.method ?? "GET",
              headers: {
                authorization: `Bearer ${token}`,
                ...(payload ? { "content-type": "application/json" } : {}),
              },
            },
            (response) => {
              const chunks: Buffer[] = [];
              response.on("data", (chunk) => chunks.push(chunk));
              response.on("end", () => {
                const raw = Buffer.concat(chunks).toString("utf8");
                resolve({
                  status: response.statusCode ?? 0,
                  body: raw ? JSON.parse(raw) : null,
                });
              });
            },
          );
          http.on("error", reject);
          if (payload) http.write(payload);
          http.end();
        });

      const attempts: Attempt[] = [];
      let agentId: string | null = null;
      let followUpNewRunId: boolean | null = null;
      try {
        const created = await api("POST", "/v1/agents", {
          name: "hitl factory c2",
          mode: "plan",
          autoCreatePR: false,
          prompt: { text: FIRST_PROMPT },
        });
        agentId = created.json?.agent?.id ?? null;
        const firstRunId = created.json?.run?.id ?? null;
        if (
          (created.status !== 200 && created.status !== 201) ||
          typeof agentId !== "string" ||
          typeof firstRunId !== "string"
        ) {
          throw new Error(
            `create failed: ${created.status} ${redact(created.json?.message)}`,
          );
        }
        console.log(`agent_id=${agentId}`);
        console.log("agent_env_has_token=false");
        let cursorRunId: string = firstRunId;
        let previousRunId: string | null = null;
        for (let n = 1; n <= 3; n++) {
          const finished = await waitForRun(agentId, cursorRunId);
          const requestMarker = finished.message
            ? extractFactoryRequest(finished.message)
            : null;
          const stop = classifyCursorFactoryStop({
            cursorStatus: finished.status,
            finalMessage: finished.message,
            phase: "implementation",
          });
          attempts.push({
            n,
            runId: cursorRunId,
            status: finished.status,
            polls: finished.polls,
            marker: requestMarker ? "present" : "absent",
            role: requestMarker?.role ?? null,
            stop,
          });
          console.log(
            `attempt=${n} run_id=${cursorRunId} status=${finished.status} polls=${finished.polls} marker=${requestMarker ? "present" : "absent"} role=${requestMarker?.role ?? "none"} stop=${stop ?? "none"} result_fields=${finished.fields.join(",")}`,
          );
          console.log(`attempt=${n} result=${redact(finished.message)}`);
          if (n === 3) break;
          if (stop !== "human-required" || !requestMarker) break;
          const prefixed = `cursor-run:${cursorRunId}`;
          const existing = database
            .select()
            .from(factoryHostRuns)
            .where(eq(factoryHostRuns.runId, prefixed))
            .get();
          const recordedRunId =
            existing?.runId ??
            recordCursorFactoryRun(database, {
              appId,
              phase: "implementation",
              cursorAgentId: agentId,
              cursorRunId,
              prompt: FIRST_PROMPT,
              idempotencyKey: `c2:${cursorRunId}`,
            }).runId;
          const posted = await request(
            `/v1/apps/${appId}/phases/implementation/questions`,
            {
              method: "POST",
              body: {
                idempotencyKey: `${recordedRunId}:request`,
                runId: recordedRunId,
                stepId: "question",
                targetRoleId: requestMarker.role,
                body: requestMarker.body,
              },
            },
          );
          expect(posted.status).toBe(201);
          const questionId = posted.body.id as string;
          const pmView = await request(
            `/v1/apps/${appId}/phases/implementation/questions/${questionId}`,
            {},
            "pm",
          );
          const devView = await request(
            `/v1/apps/${appId}/phases/implementation/questions/${questionId}`,
            {},
            "dev",
          );
          console.log(
            `question=${questionId} role=${requestMarker.role} pm_body=${pmView.body?.body ? "present" : "absent"} dev_body=${devView.body?.body ? "present" : "absent"} dev_status=${devView.status}`,
          );
          if (requestMarker.role === "project-manager") {
            expect(pmView.body?.body).toContain(requestMarker.body.trim());
            expect(devView.body?.body ?? null).toBeNull();
          }
          const answer = ANSWERS[requestMarker.role];
          if (!answer) throw new Error(`no answer for ${requestMarker.role}`);
          const token = requestMarker.role === "developer" ? "dev" : "pm";
          const answered = await request(
            `/v1/apps/${appId}/phases/implementation/questions/${questionId}/answers`,
            { method: "POST", body: { body: answer } },
            token,
          );
          expect(answered.status).toBe(200);
          expect(answered.body.resolved).toBe(true);
          const follow = database
            .select()
            .from(factoryHostRuns)
            .where(eq(factoryHostRuns.idempotencyKey, `${questionId}:resume`))
            .get();
          if (
            !follow?.cursorAgentId ||
            !follow.runId.startsWith("cursor-run:")
          ) {
            throw new Error("follow-up row was not stored");
          }
          const nextRunId = follow.runId.slice("cursor-run:".length);
          const createdNew = nextRunId !== cursorRunId;
          followUpNewRunId =
            followUpNewRunId === null
              ? createdNew
              : followUpNewRunId && createdNew;
          console.log(
            `follow_up_run_id=${nextRunId} follow_up_new_run_id=${followUpNewRunId} same_agent=${follow.cursorAgentId === agentId}`,
          );
          previousRunId = cursorRunId;
          cursorRunId = nextRunId;
        }
        expect(attempts[0]?.stop).toBe("human-required");
        expect(attempts[0]?.role).toBe("project-manager");
        expect(attempts[1]?.stop).toBe("human-required");
        expect(attempts[1]?.role).toBe("developer");
        expect(attempts[2]?.stop).toBe("ready-for-approval");
        expect(attempts[2]?.marker).toBe("absent");
        expect(followUpNewRunId).toBe(true);
        expect(previousRunId).not.toBeNull();
      } finally {
        console.log("c4_table_begin");
        for (const row of attempts) {
          console.log(
            `c4 n=${row.n} marker=${row.marker} status=${row.status} polls=${row.polls} role=${row.role ?? "none"} stop=${row.stop ?? "none"} run_id=${row.runId}`,
          );
        }
        console.log("c4_table_end");
        if (agentId) {
          const removed = await api("DELETE", `/v1/agents/${agentId}`);
          console.log(`delete_agent_status=${removed.status}`);
        }
        await new Promise<void>((resolve) => server.close(() => resolve()));
        database.$client.close();
      }
    },
    40 * 60 * 1000,
  );
});
