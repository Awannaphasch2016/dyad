import { createServer, type IncomingMessage, type Server } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { apps } from "@/db/schema";
import {
  approveFactoryPhase,
  FactoryHostError,
  linkFactoryApp,
  postFactoryHostMessage,
  readFactoryState,
  readFactoryRun,
  resolveFactoryPhaseChats,
  startFactoryRun,
  type FactoryHostDatabase,
} from "./factory_host_service";
import { MAX_CHAT_PROMPT_CHARS } from "@/shared/chatAttachmentLimits";
import type { dispatchChatIntentAndWait } from "@/ipc/services/chat_actor_service";
import { defaultVerifySessionToken } from "@/control_plane/access";
import {
  answerHitlQuestion,
  createHitlQuestion,
  getHitlQuestion,
  listHitlQuestions,
  syncRemote,
} from "@/control_plane/hitl_device";
import type { HitlCaller } from "@/control_plane/hitl";

const MAX_BODY_BYTES = 256 * 1024;
const LinkBody = z.object({
  gasCityProjectId: z.string().trim().min(1).max(256),
});
const MessageBody = z.object({
  idempotencyKey: z.string().trim().min(1).max(256),
  role: z.enum(["assistant", "system"]),
  content: z.string().min(1).max(200_000),
});
const RunBody = z.object({
  idempotencyKey: z.string().trim().min(1).max(256),
  prompt: z.string().min(1).max(MAX_CHAT_PROMPT_CHARS),
});
const QuestionBody = z.object({
  idempotencyKey: z.string().trim().min(1).max(256),
  runId: z.string().trim().min(1).max(256),
  stepId: z.string().trim().min(1).max(128),
  targetRoleId: z.string().trim().min(1).max(64),
  body: z.string().min(1).max(20_000),
  gateBeadId: z.string().trim().min(1).max(128),
});
const AnswerBody = z.object({
  body: z.string().min(1).max(20_000),
});
const Phase = z.enum(["discovery", "implementation", "delivery"]);

function json(
  response: import("node:http").ServerResponse,
  status: number,
  body: unknown,
) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new FactoryHostError("Request body too large", 413);
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new FactoryHostError("Invalid JSON body", 400);
  }
}

function tokenMatches(header: string | undefined, expected: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7));
  const wanted = Buffer.from(expected);
  return supplied.length === wanted.length && timingSafeEqual(supplied, wanted);
}

export function createFactoryHostBridgeServer(options: {
  token: string;
  database?: FactoryHostDatabase;
  dispatchChatIntent?: typeof dispatchChatIntentAndWait;
  resolveCaller?: (token: string) => Promise<HitlCaller | null>;
}): Server {
  const database = options.database ?? db;
  const resolveCaller =
    options.resolveCaller ??
    (async (sessionToken: string) => {
      try {
        const verified = await defaultVerifySessionToken(sessionToken);
        if (!verified.orgId || !verified.member) return null;
        return {
          orgId: verified.orgId,
          userId: verified.userId,
          roleId: verified.roleId,
          displayName: verified.displayName,
        };
      } catch {
        return null;
      }
    });
  return createServer(async (request, response) => {
    try {
      if (request.headers.origin !== undefined) {
        throw new FactoryHostError("Origin requests are not allowed", 403);
      }
      const machine = tokenMatches(request.headers.authorization, options.token);
      const sessionToken = request.headers.authorization?.startsWith("Bearer ")
        ? request.headers.authorization.slice(7)
        : "";
      let caller: HitlCaller | null = null;
      if (!machine && sessionToken) {
        caller = await resolveCaller(sessionToken);
      }
      if (!machine && !caller) {
        response.setHeader("www-authenticate", "Bearer");
        throw new FactoryHostError("Unauthorized", 401);
      }

      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const questionMatch = url.pathname.match(
        /^\/v1\/apps\/(\d+)\/phases\/(discovery|implementation|delivery)\/questions(?:\/([^/]+)(?:\/answers)?)?$/,
      );
      if (questionMatch) {
        const appId = Number(questionMatch[1]);
        const phase = Phase.parse(questionMatch[2]);
        const questionId = questionMatch[3] ?? null;
        const answering = url.pathname.endsWith("/answers");
        if (request.method === "POST" && !questionId && !answering) {
          if (!machine) {
            throw new FactoryHostError("Unauthorized", 401);
          }
          const row = database.select().from(apps).where(eq(apps.id, appId)).get();
          if (!row) throw new FactoryHostError("App not found", 404);
          if (row.ownerType !== "org" || !row.ownerId) {
            throw new FactoryHostError("App is not in an organization", 409);
          }
          const body = QuestionBody.parse(await readJson(request));
          const chats = resolveFactoryPhaseChats(database, appId);
          const created = createHitlQuestion(database, {
            orgId: row.ownerId,
            appId,
            phase,
            chatId: chats[phase],
            runId: body.runId,
            stepId: body.stepId,
            targetRoleId: body.targetRoleId,
            body: body.body,
            idempotencyKey: body.idempotencyKey,
            gateBeadId: body.gateBeadId,
          });
          if (created.created) await syncRemote(created.question);
          json(response, created.created ? 201 : 200, {
            id: created.question.id,
            status: created.question.status,
            stepId: created.question.stepId,
            targetRoleId: created.question.targetRoleId,
          });
          return;
        }
        if (!caller) throw new FactoryHostError("Unauthorized", 401);
        const owned = database
          .select()
          .from(apps)
          .where(eq(apps.id, appId))
          .get();
        if (!owned || owned.ownerType !== "org" || owned.ownerId !== caller.orgId) {
          throw new FactoryHostError("Not found", 404);
        }
        if (request.method === "GET" && !questionId) {
          json(response, 200, {
            questions: listHitlQuestions(database, {
              orgId: caller.orgId,
              appId,
              phase,
              caller,
            }),
          });
          return;
        }
        if (request.method === "GET" && questionId && !answering) {
          json(
            response,
            200,
            getHitlQuestion(database, { questionId, caller }),
          );
          return;
        }
        if (request.method === "POST" && questionId && answering) {
          const body = AnswerBody.parse(await readJson(request));
          const result = await answerHitlQuestion(database, {
            questionId,
            caller,
            body: body.body,
          });
          json(response, 200, result);
          return;
        }
        throw new FactoryHostError("Not found", 404);
      }
      if (!machine) throw new FactoryHostError("Unauthorized", 401);
      const runMatch = url.pathname.match(
        /^\/v1\/runs\/(gas-city-run:[a-f0-9]{64})$/,
      );
      if (request.method === "GET" && runMatch) {
        json(response, 200, readFactoryRun(database, runMatch[1]));
        return;
      }
      const match = url.pathname.match(
        /^\/v1\/apps\/(\d+)(?:\/(link|phases|factory-state))?(?:\/(discovery|implementation|delivery))?(?:\/(messages|approve|runs))?$/,
      );
      if (!match) throw new FactoryHostError("Not found", 404);
      const appId = Number(match[1]);
      const section = match[2];
      const phase = match[3] ? Phase.parse(match[3]) : null;
      const action = match[4];

      if (request.method === "PUT" && section === "link" && !phase) {
        const body = LinkBody.parse(await readJson(request));
        json(
          response,
          200,
          linkFactoryApp(database, appId, body.gasCityProjectId),
        );
        return;
      }
      if (request.method === "GET" && section === "phases" && !phase) {
        json(response, 200, resolveFactoryPhaseChats(database, appId));
        return;
      }
      if (request.method === "GET" && section === "factory-state" && !phase) {
        json(response, 200, readFactoryState(database, appId));
        return;
      }
      if (
        request.method === "POST" &&
        section === "phases" &&
        phase &&
        action === "messages"
      ) {
        if (!readFactoryState(database, appId).factoryHostManaged) {
          throw new FactoryHostError("App is not linked to Gas City", 409);
        }
        const body = MessageBody.parse(await readJson(request));
        json(
          response,
          200,
          postFactoryHostMessage(database, { appId, phase, ...body }),
        );
        return;
      }
      if (
        request.method === "POST" &&
        section === "phases" &&
        phase &&
        action === "approve"
      ) {
        if (!readFactoryState(database, appId).factoryHostManaged) {
          throw new FactoryHostError("App is not linked to Gas City", 409);
        }
        json(response, 200, approveFactoryPhase(database, appId, phase));
        return;
      }
      if (
        request.method === "POST" &&
        section === "phases" &&
        phase &&
        action === "runs"
      ) {
        const body = RunBody.parse(await readJson(request));
        json(
          response,
          202,
          await startFactoryRun(
            database,
            { appId, phase, ...body },
            options.dispatchChatIntent,
          ),
        );
        return;
      }
      throw new FactoryHostError("Not found", 404);
    } catch (error) {
      if (error instanceof z.ZodError) {
        json(response, 400, { error: "Invalid request" });
      } else if (error instanceof FactoryHostError) {
        json(response, error.statusCode, { error: error.message });
      } else {
        json(response, 500, { error: "Internal server error" });
      }
    }
  });
}

let activeServer: Server | null = null;

export async function startFactoryHostBridgeFromEnv(): Promise<void> {
  if (process.env.GAS_CITY_HOST_BRIDGE_ENABLED !== "true") return;
  const token = process.env.GAS_CITY_HOST_BRIDGE_TOKEN;
  if (!token) {
    throw new Error(
      "GAS_CITY_HOST_BRIDGE_TOKEN is required when the Gas City host bridge is enabled",
    );
  }
  const rawPort = process.env.GAS_CITY_HOST_BRIDGE_PORT ?? "32100";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      "GAS_CITY_HOST_BRIDGE_PORT must be an integer from 1 to 65535",
    );
  }
  const server = createFactoryHostBridgeServer({ token });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  activeServer = server;
}

export function stopFactoryHostBridge(): void {
  activeServer?.close();
  activeServer = null;
}
