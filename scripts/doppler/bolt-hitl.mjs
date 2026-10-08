// Question gates for the bolt preview. The organization comes from the app row.
// A saved answer does not release the Gas City rig.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const GATE_ROLE = {
  "plan-approve": "project-manager",
  "review-approve-dev": "developer",
  "review-approve-pm": "project-manager",
};

export const HITL_PHASES = ["discovery", "implementation", "delivery"];

export const SQL = {
  app: "select owner_type, owner_id from wewebplus.apps where id = $1",
  memberships:
    "select org_id, role_id from wewebplus.memberships where user_id = $1",
  membership:
    "select role_id from wewebplus.memberships where user_id = $1 and org_id = $2",
  questionByKey:
    "select id, org_id, app_id, phase, run_id, step_id, target_role_id, visibility, status, body, idempotency_key, created_at, bead_id, answered_by_user_id, answered_by_name, answered_at from wewebplus.questions where org_id = $1 and idempotency_key = $2",
  insertQuestion:
    "insert into wewebplus.questions (id, org_id, app_id, phase, run_id, step_id, target_role_id, visibility, status, body, idempotency_key, bead_id) values ($1, $2, $3, $4, $5, $6, $7, 'role', 'open', $8, $9, $10) on conflict (org_id, idempotency_key) do nothing",
  listQuestions:
    "select id, org_id, app_id, phase, run_id, step_id, target_role_id, visibility, status, body, idempotency_key, created_at, bead_id, answered_by_user_id, answered_by_name, answered_at from wewebplus.questions where org_id = $1 and phase = $2 order by created_at asc",
  questionById:
    "select id, org_id, app_id, phase, run_id, step_id, target_role_id, visibility, status, body, idempotency_key, created_at, bead_id, answered_by_user_id, answered_by_name, answered_at from wewebplus.questions where id = $1",
  markAnswered:
    "update wewebplus.questions set status = 'answered', answered_by_user_id = $2, answered_by_name = $3, answered_at = $4 where id = $1 and status = 'open' returning id",
  insertAnswer:
    "insert into wewebplus.answers (id, question_id, user_id, body) values ($1, $2, $3, $4) on conflict (question_id) do nothing",
};

export function roleForGateStep(stepId) {
  if (!Object.prototype.hasOwnProperty.call(GATE_ROLE, stepId)) return null;
  return GATE_ROLE[stepId];
}

export function presentQuestion(question, caller) {
  if (!caller || caller.orgId !== question.orgId) return null;
  const matching = caller.roleId === question.targetRoleId;
  return {
    id: question.id,
    stepId: question.stepId,
    targetRoleId: question.targetRoleId,
    status: question.status,
    answeredByName: question.answeredByName,
    body: matching ? question.body : null,
    canAnswer: matching && question.status === "open",
  };
}

export function decideAnswer(question, caller) {
  if (!caller || caller.orgId !== question.orgId) return "not-found";
  if (caller.roleId !== question.targetRoleId) return "forbidden";
  if (question.status !== "open") return "already-answered";
  return "allow";
}

export function clerkFrontendApi(publishableKey) {
  const encoded = String(publishableKey).replace(/^pk_(test|live)_/, "");
  const decoded = atob(encoded).replace(/\$$/, "");
  if (!decoded || decoded.includes(" ")) {
    throw new Error("Clerk publishable key is not usable");
  }
  return decoded;
}

function base64UrlToBytes(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export async function verifySessionJwt(token, jwks) {
  const [headerPart, payloadPart, signaturePart] = String(token).split(".");
  if (!headerPart || !payloadPart || !signaturePart) {
    throw new Error("session token is not a jwt");
  }
  const header = JSON.parse(
    new TextDecoder().decode(base64UrlToBytes(headerPart)),
  );
  const payload = JSON.parse(
    new TextDecoder().decode(base64UrlToBytes(payloadPart)),
  );
  const jwk = (jwks.keys ?? []).find((key) => key.kid === header.kid);
  if (!jwk) throw new Error("session key was not found");
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signed = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlToBytes(signaturePart),
    new TextEncoder().encode(`${headerPart}.${payloadPart}`),
  );
  if (!signed) throw new Error("session token was not signed");
  if (typeof payload.exp === "number" && payload.exp * 1000 <= Date.now()) {
    throw new Error("session token expired");
  }
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new Error("session token has no user");
  }
  return { userId: payload.sub };
}

function sessionToken(authorization, cookie, machineToken) {
  const bearer = String(authorization ?? "");
  if (bearer.startsWith("Bearer ")) {
    const token = bearer.slice("Bearer ".length).trim();
    if (token && token !== machineToken) return token;
  }
  const match = /(?:^|;\s*)__session=([^;]+)/.exec(String(cookie ?? ""));
  return match ? decodeURIComponent(match[1]) : "";
}

function rowToQuestion(row) {
  if (!row) return null;
  if (row.visibility !== "role") return null;
  if (row.status !== "open" && row.status !== "answered") return null;
  if (!roleForGateStep(row.step_id)) return null;
  return {
    id: row.id,
    orgId: row.org_id,
    appId: String(row.app_id),
    phase: row.phase,
    runId: row.run_id,
    stepId: row.step_id,
    targetRoleId: row.target_role_id,
    status: row.status,
    body: row.body,
    idempotencyKey: row.idempotency_key,
    answeredByName: row.answered_by_name,
  };
}

function unavailable() {
  return { status: 503, body: { error: "Question store is unavailable." } };
}

export async function handleHitl(input) {
  const env = input.env ?? {};
  const databaseUrl = String(env.WEWEBPLUS_DATABASE_URL ?? "").trim();
  if (!databaseUrl) return unavailable();
  const machine = String(env.GAS_CITY_HOST_BRIDGE_TOKEN ?? "").trim();
  const query = input.query;
  if (typeof query !== "function") return unavailable();

  if (input.method === "POST" && !input.questionId) {
    if (!machine || input.authorization !== `Bearer ${machine}`) {
      return { status: 401, body: { error: "Unauthorized" } };
    }
    const json = input.json ?? {};
    const phase = String(json.phase ?? "");
    const stepId = String(json.stepId ?? "");
    const expected = roleForGateStep(stepId);
    if (
      !HITL_PHASES.includes(phase) ||
      !expected ||
      json.targetRoleId !== expected ||
      !String(json.appId ?? "").trim() ||
      !String(json.runId ?? "").trim() ||
      !String(json.body ?? "").trim() ||
      !String(json.idempotencyKey ?? "").trim()
    ) {
      return { status: 400, body: { error: "Invalid gate" } };
    }
    const apps = await query(SQL.app, [String(json.appId)]);
    const app = apps[0];
    if (!app) return { status: 404, body: { error: "App not found" } };
    if (app.owner_type !== "org" || !app.owner_id) {
      return { status: 409, body: { error: "App is not in an organization" } };
    }
    const id = input.createId ?? crypto.randomUUID();
    await query(SQL.insertQuestion, [
      id,
      app.owner_id,
      String(json.appId),
      phase,
      String(json.runId),
      stepId,
      expected,
      String(json.body),
      String(json.idempotencyKey),
      json.gateBeadId ? String(json.gateBeadId) : null,
    ]);
    const stored = await query(SQL.questionByKey, [
      app.owner_id,
      String(json.idempotencyKey),
    ]);
    const question = rowToQuestion(stored[0]);
    if (!question) return unavailable();
    return {
      status: question.id === id ? 201 : 200,
      body: {
        id: question.id,
        status: question.status,
        stepId: question.stepId,
        targetRoleId: question.targetRoleId,
      },
    };
  }

  const token = sessionToken(input.authorization, input.cookie, machine);
  if (!token || !input.verifySession) {
    return { status: 401, body: { error: "Sign in to continue." } };
  }
  let userId = "";
  try {
    userId = (await input.verifySession(token)).userId;
  } catch {
    return { status: 401, body: { error: "Sign in to continue." } };
  }
  const knownRole = (roleId) =>
    roleId === "project-manager" || roleId === "developer" ? roleId : null;
  const activeOrgs = input.clerkOrgIds
    ? new Set((await input.clerkOrgIds(userId)).map(String))
    : null;
  const callerFor = async (orgId) => {
    if (activeOrgs && !activeOrgs.has(String(orgId))) return null;
    const rows = await query(SQL.membership, [userId, orgId]);
    if (!rows[0]) return null;
    return {
      orgId,
      userId,
      roleId: knownRole(rows[0].role_id),
      displayName: input.displayName ? await input.displayName(userId) : userId,
    };
  };

  if (input.method === "GET" && !input.questionId) {
    if (!input.phase || !HITL_PHASES.includes(input.phase)) {
      return { status: 404, body: { error: "Not found" } };
    }
    const views = [];
    const memberships = await query(SQL.memberships, [userId]);
    for (const membership of memberships) {
      const orgId = String(membership.org_id);
      const caller = await callerFor(orgId);
      if (!caller) continue;
      const rows = await query(SQL.listQuestions, [orgId, input.phase]);
      for (const row of rows) {
        const question = rowToQuestion(row);
        if (!question) continue;
        const view = presentQuestion(question, {
          ...caller,
          orgId,
          roleId: caller.roleId,
        });
        if (view) views.push(view);
      }
    }
    return { status: 200, body: { questions: views } };
  }

  if (input.method === "POST" && input.questionId && input.answering) {
    const rows = await query(SQL.questionById, [input.questionId]);
    const question = rowToQuestion(rows[0]);
    if (!question) return { status: 404, body: { error: "Not found" } };
    const caller = await callerFor(question.orgId);
    if (!caller) return { status: 404, body: { error: "Not found" } };
    const decision = decideAnswer(question, caller);
    if (decision === "not-found") {
      return { status: 404, body: { error: "Not found" } };
    }
    if (decision === "forbidden") {
      return {
        status: 403,
        body: { error: "Your role can't answer this question." },
      };
    }
    if (decision === "allow") {
      const body = String(input.json?.body ?? "").trim();
      if (!body) return { status: 400, body: { error: "Invalid gate" } };
      const answeredAt = input.now ?? new Date().toISOString();
      const updated = await query(SQL.markAnswered, [
        question.id,
        userId,
        caller.displayName,
        answeredAt,
      ]);
      if (updated.length > 0) {
        await query(SQL.insertAnswer, [
          input.createId ?? crypto.randomUUID(),
          question.id,
          userId,
          body,
        ]);
        question.status = "answered";
        question.answeredByName = caller.displayName;
      }
    }
    const fresh = rowToQuestion(
      (await query(SQL.questionById, [question.id]))[0] ?? rows[0],
    );
    const view = presentQuestion(fresh ?? question, caller);
    if (!view) return { status: 404, body: { error: "Not found" } };
    return { status: 200, body: { view, resolved: false } };
  }

  return { status: 404, body: { error: "Not found" } };
}

export function clerkPublishable(env) {
  const key = String(env?.CLERK_PUBLISHABLE_KEY ?? "").trim();
  if (!key.startsWith("pk_test_")) {
    return { status: 404, body: { error: "Sign in is not available." } };
  }
  return { status: 200, body: { publishableKey: key } };
}

export async function handleSession(input) {
  const env = input.env ?? {};
  const machine = String(env.GAS_CITY_HOST_BRIDGE_TOKEN ?? "").trim();
  const token = sessionToken(input.authorization, input.cookie, machine);
  if (!token || !input.verifySession) {
    return { status: 200, body: { signedIn: false } };
  }
  let userId = "";
  try {
    userId = (await input.verifySession(token)).userId;
  } catch {
    return { status: 200, body: { signedIn: false } };
  }
  const databaseUrl = String(env.WEWEBPLUS_DATABASE_URL ?? "").trim();
  if (!databaseUrl || typeof input.query !== "function") {
    return {
      status: 200,
      body: { signedIn: true, organization: null, role: null },
    };
  }
  const activeOrgs = input.clerkOrgIds
    ? new Set((await input.clerkOrgIds(userId)).map(String))
    : null;
  const memberships = await input.query(SQL.memberships, [userId]);
  const usable = memberships.filter((row) => {
    if (row.role_id !== "project-manager" && row.role_id !== "developer") {
      return false;
    }
    if (activeOrgs && !activeOrgs.has(String(row.org_id))) return false;
    return true;
  });
  if (usable.length !== 1) {
    return {
      status: 200,
      body: { signedIn: true, organization: null, role: null },
    };
  }
  const row = usable[0];
  const orgId = String(row.org_id);
  const names = input.orgNames ? await input.orgNames([orgId]) : {};
  return {
    status: 200,
    body: {
      signedIn: true,
      organization: names[orgId] ?? null,
      role: row.role_id === "project-manager" ? "Project Manager" : "Developer",
    },
  };
}

export function neonSqlEndpoint(databaseUrl) {
  const parsed = new URL(databaseUrl);
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error("Question store is unavailable.");
  }
  return `https://${parsed.host}/sql`;
}

const barImport =
  "import type { FactoryPhaseComment } from '~/lib/factoryRun';";
const barImportFixed = `${barImport}
import { HitlGateList } from './HitlGateList';`;
const barAnchor = `      <p className="mt-2 text-xs text-bolt-elements-textSecondary">
        {factoryPhaseHint(phase)}`;
const barAnchorFixed = `      <HitlGateList phase={phase} />
      <p className="mt-2 text-xs text-bolt-elements-textSecondary">
        {factoryPhaseHint(phase)}`;

const headerImport = "import { classNames } from '~/utils/classNames';";
const headerAnchor = `      )}
    </header>`;
const headerAnchorFixed = `      )}
      {!chat.started ? <span className="flex-1" /> : null}
      <BoltSignIn />
    </header>`;

export function patchBoltHeader(source) {
  if (source.includes("<BoltSignIn />")) return source;
  if (!source.includes(headerImport) || !source.includes(headerAnchor)) {
    throw new Error("bolt header was not found");
  }
  return source
    .replace(
      headerImport,
      `${headerImport}\nimport { BoltSignIn } from './BoltSignIn';`,
    )
    .replace(headerAnchor, headerAnchorFixed);
}

export function patchFactoryPhaseBar(source) {
  if (source.includes("<HitlGateList phase={phase} />")) return source;
  if (!source.includes(barImport) || !source.includes(barAnchor)) {
    throw new Error("factory phase bar was not found");
  }
  return source
    .replace(barImport, barImportFixed)
    .replace(barAnchor, barAnchorFixed);
}

function hitlGateListSource() {
  return `import { useEffect, useState } from 'react';
import { clerkReady, hitlFetch, onClerkSession } from '~/lib/hitl/client';

interface HitlView {
  id: string;
  stepId: string;
  targetRoleId: string;
  status: 'open' | 'answered';
  answeredByName: string | null;
  body: string | null;
  canAnswer: boolean;
}

export function HitlGateList({ phase }: { phase: string }) {
  const [questions, setQuestions] = useState<HitlView[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void hitlFetch(\`/api/hitl?phase=\${phase}\`)
        .then(async (response) => {
          if (!response.ok) return [];
          const payload = (await response.json()) as { questions?: HitlView[] };
          return payload.questions ?? [];
        })
        .then((next) => {
          if (!cancelled) setQuestions(next);
        })
        .catch(() => {
          if (!cancelled) setQuestions([]);
        });
    };
    void clerkReady().then(() => {
      if (!cancelled) load();
    });
    const stop = onClerkSession(() => {
      if (!cancelled) load();
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, [phase]);

  if (questions.length === 0) return null;
  return (
    <div className="mt-2 space-y-2" data-testid="hitl-questions">
      {questions.map((question) => (
        <HitlGateRow
          key={question.id}
          question={question}
          onReload={(next) => setQuestions(next)}
          phase={phase}
        />
      ))}
    </div>
  );
}

function HitlGateRow({
  question,
  phase,
  onReload,
}: {
  question: HitlView;
  phase: string;
  onReload: (next: HitlView[]) => void;
}) {
  const [body, setBody] = useState('');
  const [pending, setPending] = useState(false);
  const roleLabel = question.targetRoleId === 'project-manager' ? 'Project Manager' : 'Developer';
  return (
    <div className="rounded-md border border-bolt-elements-borderColor px-2 py-2 text-sm" data-testid={\`hitl-question-\${question.id}\`}>
      <p>
        Waiting on {roleLabel} for {question.stepId}. Status: {question.status}.
        {question.status === 'answered' && question.answeredByName ? \` Answered by \${question.answeredByName}.\` : ''}
      </p>
      {question.body != null ? <p className="mt-1 whitespace-pre-wrap">{question.body}</p> : null}
      {question.canAnswer ? (
        <form
          className="mt-2 flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const answer = body.trim();
            if (!answer || pending) return;
            setPending(true);
            void hitlFetch(\`/api/hitl/\${question.id}/answers\`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ body: answer }),
            })
              .then(() => hitlFetch(\`/api/hitl?phase=\${phase}\`))
              .then(async (response) => {
                if (!response.ok) return;
                const payload = (await response.json()) as { questions?: HitlView[] };
                setBody('');
                onReload(payload.questions ?? []);
              })
              .finally(() => setPending(false));
          }}
        >
          <input
            aria-label={\`Answer \${question.stepId}\`}
            className="h-8 min-w-0 flex-1 rounded-md border border-bolt-elements-borderColor bg-transparent px-2 text-sm"
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
          <button type="submit" className="rounded-md bg-accent-500 px-2.5 py-1 text-sm text-white" disabled={pending}>
            Submit answer
          </button>
        </form>
      ) : null}
    </div>
  );
}
`;
}

function hitlRouteSource() {
  return `import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { handleHitlRequest } from '~/lib/hitl/server';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const result = await handleHitlRequest({
    method: 'GET',
    phase: url.searchParams.get('phase') ?? '',
    authorization: request.headers.get('authorization'),
    cookie: request.headers.get('cookie'),
    env: context.cloudflare?.env ?? process.env,
  });
  return Response.json(result.body, { status: result.status });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const json = (await request.json().catch(() => ({}))) as { phase?: string };
  const result = await handleHitlRequest({
    method: request.method,
    phase: json.phase ?? '',
    authorization: request.headers.get('authorization'),
    cookie: request.headers.get('cookie'),
    json,
    env: context.cloudflare?.env ?? process.env,
  });
  return Response.json(result.body, { status: result.status });
}
`;
}

function hitlAnswerRouteSource() {
  return `import type { ActionFunctionArgs } from 'react-router';
import { handleHitlRequest } from '~/lib/hitl/server';

export async function action({ request, context, params }: ActionFunctionArgs) {
  const json = (await request.json().catch(() => ({}))) as { body?: string };
  const result = await handleHitlRequest({
    method: request.method,
    phase: '',
    questionId: params.id ? String(params.id) : '',
    answering: true,
    authorization: request.headers.get('authorization'),
    cookie: request.headers.get('cookie'),
    json,
    env: context.cloudflare?.env ?? process.env,
  });
  return Response.json(result.body, { status: result.status });
}
`;
}

export function applyBoltHitlPatches(boltRoot) {
  const barPath = join(boltRoot, "app/components/factory/FactoryPhaseBar.tsx");
  const source = readFileSync(barPath, "utf8");
  const patched = patchFactoryPhaseBar(source);
  if (patched !== source) writeFileSync(barPath, patched);
  writeFileSync(
    join(boltRoot, "app/components/factory/HitlGateList.tsx"),
    hitlGateListSource(),
  );
  const routesDir = join(boltRoot, "app/routes");
  mkdirSync(routesDir, { recursive: true });
  writeFileSync(join(routesDir, "api.hitl.ts"), hitlRouteSource());
  writeFileSync(
    join(routesDir, "api.hitl.$id.answers.ts"),
    hitlAnswerRouteSource(),
  );
  const hitlDir = join(boltRoot, "app/lib/hitl");
  mkdirSync(hitlDir, { recursive: true });
  writeFileSync(join(hitlDir, "server.ts"), hitlServerSource());
  writeFileSync(join(hitlDir, "client.ts"), hitlClientSource());
  const headerDir = join(boltRoot, "app/components/header");
  mkdirSync(headerDir, { recursive: true });
  writeFileSync(join(headerDir, "BoltSignIn.tsx"), boltSignInSource());
  writeFileSync(join(routesDir, "api.clerk.ts"), clerkRouteSource());
  writeFileSync(join(routesDir, "api.session.ts"), sessionRouteSource());
  const headerPath = join(headerDir, "Header.tsx");
  let signIn = "absent";
  try {
    const header = readFileSync(headerPath, "utf8");
    const patchedHeader = patchBoltHeader(header);
    if (patchedHeader !== header) writeFileSync(headerPath, patchedHeader);
    signIn = patchedHeader === header ? "already" : "applied";
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return [
    `hitl_bar_patch=${patched === source ? "already" : "applied"}`,
    "hitl_module=written",
    `sign_in_patch=${signIn}`,
  ];
}

function hitlServerSource() {
  return `// Generated for the walkthrough Worker. Organization comes from wewebplus.apps.

export const GATE_ROLE = {
  'plan-approve': 'project-manager',
  'review-approve-dev': 'developer',
  'review-approve-pm': 'project-manager',
} as const;

const PHASES = ['discovery', 'implementation', 'delivery'];

type Env = {
  WEWEBPLUS_DATABASE_URL?: string;
  GAS_CITY_HOST_BRIDGE_TOKEN?: string;
  CLERK_SECRET_KEY?: string;
  CLERK_PUBLISHABLE_KEY?: string;
};

function gateEnv(value: unknown): Env {
  const record = (value ?? {}) as Record<string, string | undefined>;
  return {
    WEWEBPLUS_DATABASE_URL: record.WEWEBPLUS_DATABASE_URL,
    GAS_CITY_HOST_BRIDGE_TOKEN: record.GAS_CITY_HOST_BRIDGE_TOKEN,
    CLERK_SECRET_KEY: record.CLERK_SECRET_KEY,
    CLERK_PUBLISHABLE_KEY: record.CLERK_PUBLISHABLE_KEY,
  };
}

type QueryRow = Record<string, unknown>;

async function neonQuery(databaseUrl: string, query: string, params: unknown[]): Promise<QueryRow[]> {
  const endpoint = new URL(databaseUrl);
  const response = await fetch(\`https://\${endpoint.host}/sql\`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Neon-Connection-String': databaseUrl,
    },
    body: JSON.stringify({ query, params }),
  });
  if (!response.ok) throw new Error('Question store is unavailable.');
  const payload = (await response.json()) as { rows?: unknown[]; fields?: { name: string }[] };
  const fields = payload.fields ?? [];
  return (payload.rows ?? []).map((row) => {
    if (Array.isArray(row)) {
      const record: QueryRow = {};
      fields.forEach((field, index) => {
        record[field.name] = row[index];
      });
      return record;
    }
    return (row ?? {}) as QueryRow;
  });
}

function present(question: QueryRow, roleId: string | null, orgId: string) {
  if (question.org_id !== orgId) return null;
  const matching = roleId === question.target_role_id;
  return {
    id: question.id,
    stepId: question.step_id,
    targetRoleId: question.target_role_id,
    status: question.status,
    answeredByName: question.answered_by_name,
    body: matching ? question.body : null,
    canAnswer: matching && question.status === 'open',
  };
}

async function clerkUser(env: Env, token: string) {
  const secret = env.CLERK_SECRET_KEY?.trim();
  const publishable = env.CLERK_PUBLISHABLE_KEY?.trim();
  if (!secret || !publishable?.startsWith('pk_test_')) throw new Error('Sign in to continue.');
  const encoded = publishable.slice('pk_test_'.length);
  const frontendApi = atob(encoded).replace(/\\$$/, '');
  const jwksResponse = await fetch(\`https://\${frontendApi}/.well-known/jwks.json\`);
  if (!jwksResponse.ok) throw new Error('Sign in to continue.');
  const jwks = (await jwksResponse.json()) as { keys: (JsonWebKey & { kid?: string })[] };
  const [headerPart, payloadPart, signaturePart] = token.split('.');
  if (!headerPart || !payloadPart || !signaturePart) throw new Error('Sign in to continue.');
  const decode = (value: string) => {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/');
    return atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  };
  const header = JSON.parse(decode(headerPart)) as { kid?: string };
  const jwk = jwks.keys.find((key) => key.kid === header.kid);
  if (!jwk) throw new Error('Sign in to continue.');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const signature = Uint8Array.from(decode(signaturePart), (char) => char.charCodeAt(0));
  const signed = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, new TextEncoder().encode(\`\${headerPart}.\${payloadPart}\`));
  if (!signed) throw new Error('Sign in to continue.');
  const payload = JSON.parse(decode(payloadPart)) as { sub?: string; exp?: number };
  if (typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now()) throw new Error('Sign in to continue.');
  if (!payload.sub) throw new Error('Sign in to continue.');
  const userResponse = await fetch(\`https://api.clerk.com/v1/users/\${payload.sub}\`, {
    headers: { Authorization: \`Bearer \${secret}\` },
  });
  let displayName = payload.sub;
  if (userResponse.ok) {
    const user = (await userResponse.json()) as { first_name?: string | null; last_name?: string | null };
    const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
    if (name) displayName = name;
  }
  return { userId: payload.sub, displayName };
}

async function clerkOrganizationIds(env: Env, userId: string): Promise<Set<string>> {
  const secret = env.CLERK_SECRET_KEY?.trim();
  if (!secret) throw new Error('Sign in to continue.');
  const response = await fetch(
    \`https://api.clerk.com/v1/users/\${encodeURIComponent(userId)}/organization_memberships?limit=100\`,
    { headers: { Authorization: \`Bearer \${secret}\` } },
  );
  if (!response.ok) throw new Error('Sign in to continue.');
  const payload = (await response.json()) as {
    data?: { organization?: { id?: string } }[];
  };
  const ids = new Set<string>();
  for (const row of payload.data ?? []) {
    if (row.organization?.id) ids.add(row.organization.id);
  }
  return ids;
}

async function organizationName(env: Env, orgId: string): Promise<string | null> {
  const secret = env.CLERK_SECRET_KEY?.trim();
  if (!secret) return null;
  const response = await fetch(\`https://api.clerk.com/v1/organizations/\${encodeURIComponent(orgId)}\`, {
    headers: { Authorization: \`Bearer \${secret}\` },
  });
  if (!response.ok) return null;
  const org = (await response.json()) as { name?: string };
  return org.name ?? null;
}

function sessionToken(authorization: string | null, cookie: string | null, machine: string) {
  const bearer = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : '';
  if (bearer && bearer !== machine) return bearer;
  const cookieMatch = /(?:^|;\\s*)__session=([^;]+)/.exec(cookie ?? '');
  return cookieMatch ? decodeURIComponent(cookieMatch[1]) : '';
}

export function clerkPublishableResponse(value: unknown) {
  const env = gateEnv(value);
  const key = env.CLERK_PUBLISHABLE_KEY?.trim() ?? '';
  if (!key.startsWith('pk_test_')) {
    return { status: 404, body: { error: 'Sign in is not available.' } };
  }
  return { status: 200, body: { publishableKey: key } };
}

export async function handleSessionRequest(input: {
  authorization: string | null;
  cookie: string | null;
  env: unknown;
}) {
  const env = gateEnv(input.env);
  const databaseUrl = env.WEWEBPLUS_DATABASE_URL?.trim() ?? '';
  const machine = env.GAS_CITY_HOST_BRIDGE_TOKEN?.trim() ?? '';
  const token = sessionToken(input.authorization, input.cookie, machine);
  if (!token) return { status: 200, body: { signedIn: false } };
  try {
    const user = await clerkUser(env, token);
    if (!databaseUrl) {
      return { status: 200, body: { signedIn: true, organization: null, role: null } };
    }
    const active = await clerkOrganizationIds(env, user.userId);
    const memberships = await neonQuery(
      databaseUrl,
      'select org_id, role_id from wewebplus.memberships where user_id = $1',
      [user.userId],
    );
    const usable = memberships.filter((row) => {
      const role = row.role_id;
      if (role !== 'project-manager' && role !== 'developer') return false;
      return active.has(String(row.org_id));
    });
    if (usable.length !== 1) {
      return { status: 200, body: { signedIn: true, organization: null, role: null } };
    }
    const orgId = String(usable[0].org_id);
    const role = usable[0].role_id === 'project-manager' ? 'Project Manager' : 'Developer';
    return {
      status: 200,
      body: { signedIn: true, organization: await organizationName(env, orgId), role },
    };
  } catch {
    return { status: 200, body: { signedIn: false } };
  }
}

export async function handleHitlRequest(input: {
  method: string;
  phase: string;
  questionId?: string;
  answering?: boolean;
  authorization: string | null;
  cookie: string | null;
  json?: unknown;
  env: unknown;
}) {
  const env = gateEnv(input.env);
  const databaseUrl = env.WEWEBPLUS_DATABASE_URL?.trim() ?? '';
  if (!databaseUrl) return { status: 503, body: { error: 'Question store is unavailable.' } };
  const query = (sql: string, params: unknown[]) => neonQuery(databaseUrl, sql, params);
  const machine = env.GAS_CITY_HOST_BRIDGE_TOKEN?.trim() ?? '';
  try {
    if (input.method === 'POST' && !input.questionId) {
      if (!machine || input.authorization !== \`Bearer \${machine}\`) {
        return { status: 401, body: { error: 'Unauthorized' } };
      }
      const json = (input.json ?? {}) as Record<string, unknown>;
      const phase = String(json.phase ?? '');
      const stepId = String(json.stepId ?? '');
      const expected = Object.prototype.hasOwnProperty.call(GATE_ROLE, stepId)
        ? GATE_ROLE[stepId as keyof typeof GATE_ROLE]
        : '';
      if (!PHASES.includes(phase) || !expected || json.targetRoleId !== expected || !String(json.appId ?? '').trim() || !String(json.runId ?? '').trim() || !String(json.body ?? '').trim() || !String(json.idempotencyKey ?? '').trim()) {
        return { status: 400, body: { error: 'Invalid gate' } };
      }
      const apps = await query('select owner_type, owner_id from wewebplus.apps where id = $1', [String(json.appId)]);
      const app = apps[0];
      if (!app) return { status: 404, body: { error: 'App not found' } };
      if (app.owner_type !== 'org' || !app.owner_id) {
        return { status: 409, body: { error: 'App is not in an organization' } };
      }
      const id = crypto.randomUUID();
      await query(
        "insert into wewebplus.questions (id, org_id, app_id, phase, run_id, step_id, target_role_id, visibility, status, body, idempotency_key, bead_id) values ($1, $2, $3, $4, $5, $6, $7, 'role', 'open', $8, $9, $10) on conflict (org_id, idempotency_key) do nothing",
        [id, app.owner_id, String(json.appId), phase, String(json.runId), stepId, expected, String(json.body), String(json.idempotencyKey), json.gateBeadId ? String(json.gateBeadId) : null],
      );
      const stored = await query(
        'select id, status, step_id, target_role_id from wewebplus.questions where org_id = $1 and idempotency_key = $2',
        [app.owner_id, String(json.idempotencyKey)],
      );
      const question = stored[0];
      if (!question) return { status: 503, body: { error: 'Question store is unavailable.' } };
      return {
        status: question.id === id ? 201 : 200,
        body: { id: question.id, status: question.status, stepId: question.step_id, targetRoleId: question.target_role_id },
      };
    }
    const token = sessionToken(input.authorization, input.cookie, machine);
    if (!token) return { status: 401, body: { error: 'Sign in to continue.' } };
    const user = await clerkUser(env, token);
    const activeOrgs = await clerkOrganizationIds(env, user.userId);
    if (input.method === 'GET') {
      if (!PHASES.includes(input.phase)) return { status: 404, body: { error: 'Not found' } };
      const memberships = await query(
        'select org_id, role_id from wewebplus.memberships where user_id = $1',
        [user.userId],
      );
      const questions = [];
      for (const membership of memberships) {
        if (!activeOrgs.has(String(membership.org_id))) continue;
        const roleId = membership.role_id === 'project-manager' || membership.role_id === 'developer' ? String(membership.role_id) : null;
        const rows = await query(
          'select id, org_id, step_id, target_role_id, status, body, answered_by_name from wewebplus.questions where org_id = $1 and phase = $2 order by created_at asc',
          [membership.org_id, input.phase],
        );
        for (const row of rows) {
          const view = present(row, roleId, String(membership.org_id));
          if (view) questions.push(view);
        }
      }
      return { status: 200, body: { questions } };
    }
    if (input.method === 'POST' && input.answering && input.questionId) {
      const rows = await query(
        'select id, org_id, step_id, target_role_id, status, body, answered_by_name from wewebplus.questions where id = $1',
        [input.questionId],
      );
      const question = rows[0];
      if (!question || !activeOrgs.has(String(question.org_id))) return { status: 404, body: { error: 'Not found' } };
      const memberships = await query(
        'select role_id from wewebplus.memberships where user_id = $1 and org_id = $2',
        [user.userId, question.org_id],
      );
      const roleId = memberships[0]?.role_id === 'project-manager' || memberships[0]?.role_id === 'developer' ? String(memberships[0].role_id) : null;
      if (!roleId) return { status: 404, body: { error: 'Not found' } };
      if (roleId !== question.target_role_id) {
        return { status: 403, body: { error: "Your role can't answer this question." } };
      }
      if (question.status === 'open') {
        const body = String((input.json as { body?: string } | undefined)?.body ?? '').trim();
        if (!body) return { status: 400, body: { error: 'Invalid gate' } };
        const updated = await query(
          "update wewebplus.questions set status = 'answered', answered_by_user_id = $2, answered_by_name = $3, answered_at = now() where id = $1 and status = 'open' returning id",
          [question.id, user.userId, user.displayName],
        );
        if (updated.length > 0) {
          await query(
            'insert into wewebplus.answers (id, question_id, user_id, body) values ($1, $2, $3, $4) on conflict (question_id) do nothing',
            [crypto.randomUUID(), question.id, user.userId, body],
          );
        }
      }
      const fresh = (await query(
        'select id, org_id, step_id, target_role_id, status, body, answered_by_name from wewebplus.questions where id = $1',
        [question.id],
      ))[0];
      return { status: 200, body: { view: present(fresh ?? question, roleId, String(question.org_id)), resolved: false } };
    }
    return { status: 404, body: { error: 'Not found' } };
  } catch {
    return { status: 503, body: { error: 'Question store is unavailable.' } };
  }
}
`;
}

function hitlClientSource() {
  return `type ClerkSession = {
  getToken: () => Promise<string | null>;
};

type ClerkGlobal = {
  load: () => Promise<void>;
  redirectToSignIn: (options?: { redirectUrl?: string }) => Promise<unknown> | unknown;
  signOut: (options?: { redirectUrl?: string }) => Promise<unknown> | unknown;
  session?: ClerkSession | null;
  addListener: (callback: () => void) => void;
};

declare global {
  interface Window {
    Clerk?: ClerkGlobal;
  }
}

let clerkStart: Promise<boolean> | null = null;
const sessionListeners = new Set<() => void>();
let sessionListening = false;

export function clerkReady(): Promise<boolean> {
  if (!clerkStart) {
    clerkStart = (async () => {
      const configResponse = await fetch('/api/clerk');
      if (!configResponse.ok) return false;
      const config = (await configResponse.json()) as { publishableKey?: string };
      const publishableKey = config.publishableKey ?? '';
      if (!publishableKey.startsWith('pk_test_')) return false;
      await loadClerk(publishableKey);
      if (!window.Clerk) return false;
      await window.Clerk.load();
      return true;
    })();
  }
  return clerkStart;
}

export function onClerkSession(callback: () => void): () => void {
  sessionListeners.add(callback);
  void clerkReady().then((ready) => {
    if (!ready || !window.Clerk || sessionListening) return;
    sessionListening = true;
    window.Clerk.addListener(() => {
      for (const listener of sessionListeners) listener();
    });
  });
  return () => {
    sessionListeners.delete(callback);
  };
}

export async function clerkBearer(): Promise<string | null> {
  await clerkReady();
  const token = await window.Clerk?.session?.getToken();
  return token ?? null;
}

export async function hitlFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = await clerkBearer();
  if (token) headers.set('Authorization', \`Bearer \${token}\`);
  return fetch(url, { ...init, headers });
}

function loadClerk(publishableKey: string): Promise<void> {
  if (window.Clerk) return Promise.resolve();
  const encoded = publishableKey.slice('pk_test_'.length);
  const frontendApi = atob(encoded).replace(/\\$$/, '');
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.dataset.clerkPublishableKey = publishableKey;
    script.src = \`https://\${frontendApi}/npm/@clerk/clerk-js@5/dist/clerk.browser.js\`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Clerk did not load'));
    document.head.appendChild(script);
  });
}
`;
}

function boltSignInSource() {
  return `import { useEffect, useState } from 'react';
import { clerkReady } from '~/lib/hitl/client';

type SessionView = {
  signedIn: boolean;
  organization?: string | null;
  role?: string | null;
};

export function BoltSignIn() {
  const [view, setView] = useState<SessionView>({ signedIn: false });
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const token = await window.Clerk?.session?.getToken();
      if (!token) {
        if (!cancelled) setView({ signedIn: false });
        return;
      }
      const response = await fetch('/api/session', {
        headers: { Authorization: \`Bearer \${token}\` },
      });
      if (!response.ok) {
        if (!cancelled) setView({ signedIn: true, organization: null, role: null });
        return;
      }
      const next = (await response.json()) as SessionView;
      if (!cancelled) setView(next);
    };
    void clerkReady()
      .then(async (ready) => {
        if (!ready || !window.Clerk) {
          if (!cancelled) setFailed(true);
          return;
        }
        window.Clerk.addListener(() => {
          void refresh();
        });
        await refresh();
        if (!cancelled) setReady(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (view.signedIn) {
    const label = [view.organization, view.role].filter(Boolean).join(' · ');
    return (
      <div className="ml-auto flex items-center gap-2 text-sm text-bolt-elements-textPrimary" data-testid="bolt-account">
        {label ? <span>{label}</span> : null}
        <button
          type="button"
          className="rounded-md border border-bolt-elements-borderColor px-2.5 py-1 text-sm"
          onClick={() => {
            void Promise.resolve(window.Clerk?.signOut({ redirectUrl: window.location.href })).then(() => {
              window.location.reload();
            });
          }}
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="ml-auto rounded-md bg-accent-500 px-2.5 py-1 text-sm text-white disabled:opacity-60"
      data-testid="bolt-sign-in"
      disabled={!ready || failed}
      onClick={() => {
        void window.Clerk?.redirectToSignIn({ redirectUrl: window.location.href });
      }}
    >
      {failed ? 'Sign in did not load' : 'Sign in'}
    </button>
  );
}
`;
}

function clerkRouteSource() {
  return `import type { LoaderFunctionArgs } from 'react-router';
import { clerkPublishableResponse } from '~/lib/hitl/server';

export async function loader({ context }: LoaderFunctionArgs) {
  const result = clerkPublishableResponse(context.cloudflare?.env ?? process.env);
  return Response.json(result.body, { status: result.status });
}
`;
}

function sessionRouteSource() {
  return `import type { LoaderFunctionArgs } from 'react-router';
import { handleSessionRequest } from '~/lib/hitl/server';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const result = await handleSessionRequest({
    authorization: request.headers.get('authorization'),
    cookie: request.headers.get('cookie'),
    env: context.cloudflare?.env ?? process.env,
  });
  return Response.json(result.body, { status: result.status });
}
`;
}
