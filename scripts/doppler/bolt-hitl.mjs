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
  const callerFor = async (orgId) => {
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
    void fetch(\`/api/hitl?phase=\${phase}\`)
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
    return () => {
      cancelled = true;
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
            void fetch(\`/api/hitl/\${question.id}/answers\`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ body: answer }),
            })
              .then(() => fetch(\`/api/hitl?phase=\${phase}\`))
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
  return [
    `hitl_bar_patch=${patched === source ? "already" : "applied"}`,
    "hitl_module=written",
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
  if (!secret || !publishable) throw new Error('Sign in to continue.');
  const encoded = publishable.replace(/^pk_(test|live)_/, '');
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

export async function handleHitlRequest(input: {
  method: string;
  phase: string;
  questionId?: string;
  answering?: boolean;
  authorization: string | null;
  cookie: string | null;
  json?: unknown;
  env: Env;
}) {
  const databaseUrl = input.env.WEWEBPLUS_DATABASE_URL?.trim() ?? '';
  if (!databaseUrl) return { status: 503, body: { error: 'Question store is unavailable.' } };
  const query = (sql: string, params: unknown[]) => neonQuery(databaseUrl, sql, params);
  const machine = input.env.GAS_CITY_HOST_BRIDGE_TOKEN?.trim() ?? '';
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
    const bearer = input.authorization?.startsWith('Bearer ') ? input.authorization.slice('Bearer '.length).trim() : '';
    const cookieMatch = /(?:^|;\\s*)__session=([^;]+)/.exec(input.cookie ?? '');
    const token = bearer && bearer !== machine ? bearer : cookieMatch ? decodeURIComponent(cookieMatch[1]) : '';
    if (!token) return { status: 401, body: { error: 'Sign in to continue.' } };
    const user = await clerkUser(input.env, token);
    if (input.method === 'GET') {
      if (!PHASES.includes(input.phase)) return { status: 404, body: { error: 'Not found' } };
      const memberships = await query(
        'select org_id, role_id from wewebplus.memberships where user_id = $1',
        [user.userId],
      );
      const questions = [];
      for (const membership of memberships) {
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
      if (!question) return { status: 404, body: { error: 'Not found' } };
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
