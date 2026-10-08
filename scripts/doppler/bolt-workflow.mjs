// Shared Discovery, Implementation, and Delivery project for the bolt preview.
// Postgres is the phase. The page polls it. A question answer does not move it.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SQL, decideAnswer, sessionToken } from "./bolt-hitl.mjs";
import { WALKTHROUGH_APP_ID, WALKTHROUGH_CHAT_ID } from "./bolt-sign-in.mjs";

export const DISCOVERY_MODEL = "anthropic/claude-sonnet-5.5";
export const MODEL_FALLBACK = "The reply could not be started.";
export const IMPLEMENTATION_QUESTION_ID =
  "bolt-walkthrough:implementation:review-approve-dev";
export const IMPLEMENTATION_QUESTION_BODY =
  "Approve the Implementation review.";

export const WORKFLOW_SQL = {
  project:
    "select phase, document_html from wewebplus.project_state where app_id = $1",
  messages:
    "select role, content from wewebplus.messages where chat_id = $1 order by created_at asc",
  insertMessage:
    "insert into wewebplus.messages (id, chat_id, role, content) values ($1, $2, $3, $4)",
  lockPrompt:
    "update wewebplus.project_state set busy = true where app_id = $1 and busy = false and phase = 'discovery' returning app_id",
  unlockPrompt:
    "update wewebplus.project_state set busy = false where app_id = $1",
  casPhase:
    "update wewebplus.project_state set phase = $2, delivered_at = case when $2 = 'delivered' then now() else delivered_at end, document_html = case when $2 = 'delivered' then $4 else document_html end where app_id = $1 and phase = $3 returning phase",
  questions:
    "select id, org_id, app_id, phase, step_id, target_role_id, status, body, answered_by_name from wewebplus.questions where org_id = $1 and app_id = $2 order by created_at asc",
};

export function nextPhase(phase, roleId) {
  if (phase === "discovery" && roleId === "project-manager") {
    return "implementation";
  }
  if (phase === "implementation" && roleId === "developer") return "delivery";
  if (phase === "delivery" && roleId === "project-manager") return "delivered";
  return null;
}

export function transitionLabel(phase) {
  if (phase === "discovery") return "Move to Implementation";
  if (phase === "implementation") return "Move to Delivery";
  if (phase === "delivery") return "Approve delivery";
  return null;
}

export function canSendPrompt(phase, roleId) {
  return phase === "discovery" && roleId === "project-manager";
}

export function isSharedQuestion(question) {
  return (
    question?.phase === "implementation" &&
    question?.stepId === "review-approve-dev" &&
    question?.targetRoleId === "developer"
  );
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function deliveryDocument(messages) {
  const items = (messages ?? [])
    .map(
      (message) =>
        `<p><strong>${escapeHtml(message.role)}</strong> ${escapeHtml(message.content)}</p>`,
    )
    .join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Delivered</title></head><body><h1>Delivered</h1>\n${items}\n</body></html>`;
}

export function presentSnapshot({
  phase,
  messages,
  questions,
  roleId,
  documentHtml,
}) {
  const next = nextPhase(phase, roleId);
  const shown = (questions ?? []).filter(isSharedQuestion).map((question) => ({
    id: question.id,
    stepId: question.stepId,
    targetRoleId: question.targetRoleId,
    status: question.status,
    answeredByName: question.answeredByName ?? null,
    body: roleId === question.targetRoleId ? question.body : null,
    canAnswer:
      roleId === "developer" &&
      question.status === "open" &&
      phase === "implementation",
  }));
  return {
    phase,
    messages: (messages ?? []).map((message) => ({
      role: message.role,
      content: message.content,
    })),
    canSend: canSendPrompt(phase, roleId),
    canTransition: next != null,
    transitionLabel: next ? transitionLabel(phase) : null,
    canDownload:
      phase === "delivered" &&
      typeof documentHtml === "string" &&
      documentHtml.length > 0,
    questions: shown,
  };
}

function questionFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    orgId: row.org_id,
    phase: row.phase,
    stepId: row.step_id,
    targetRoleId: row.target_role_id,
    status: row.status,
    body: row.body,
    answeredByName: row.answered_by_name ?? null,
  };
}

function unavailable() {
  return { status: 503, body: { error: "Project store is unavailable." } };
}

export async function handleProject(input) {
  const env = input.env ?? {};
  const databaseUrl = String(env.WEWEBPLUS_DATABASE_URL ?? "").trim();
  if (!databaseUrl) return unavailable();
  const query = input.query;
  if (typeof query !== "function") return unavailable();
  const machine = String(env.GAS_CITY_HOST_BRIDGE_TOKEN ?? "").trim();
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
  const apps = await query(SQL.app, [WALKTHROUGH_APP_ID]);
  const app = apps[0];
  if (!app || app.owner_type !== "org" || !app.owner_id) {
    return { status: 404, body: { error: "Not found" } };
  }
  const orgId = String(app.owner_id);
  const activeOrgs = input.clerkOrgIds
    ? new Set((await input.clerkOrgIds(userId)).map(String))
    : null;
  if (activeOrgs && !activeOrgs.has(orgId)) {
    return { status: 404, body: { error: "Not found" } };
  }
  const memberships = await query(SQL.membership, [userId, orgId]);
  const roleId = memberships[0]?.role_id;
  if (roleId !== "project-manager" && roleId !== "developer") {
    return { status: 404, body: { error: "Not found" } };
  }
  const caller = {
    orgId,
    userId,
    roleId,
    displayName: input.displayName ? await input.displayName(userId) : userId,
  };
  const readState = async () => {
    const rows = await query(WORKFLOW_SQL.project, [WALKTHROUGH_APP_ID]);
    const row = rows[0];
    if (!row) return null;
    const messages = await query(WORKFLOW_SQL.messages, [WALKTHROUGH_CHAT_ID]);
    const questions = (
      await query(WORKFLOW_SQL.questions, [orgId, WALKTHROUGH_APP_ID])
    )
      .map(questionFromRow)
      .filter(Boolean);
    return {
      phase: row.phase,
      documentHtml: row.document_html ?? null,
      messages: messages.map((item) => ({
        role: item.role,
        content: item.content,
      })),
      questions,
    };
  };
  const snapshot = async () => {
    const state = await readState();
    if (!state) return null;
    return presentSnapshot({ ...state, roleId });
  };

  if (input.document) {
    const state = await readState();
    if (!state || state.phase !== "delivered" || !state.documentHtml) {
      return { status: 404, body: { error: "Not found" } };
    }
    return { status: 200, body: state.documentHtml, html: true };
  }

  if (input.method === "GET") {
    const body = await snapshot();
    if (!body) return unavailable();
    return { status: 200, body };
  }
  if (input.method !== "POST") {
    return { status: 404, body: { error: "Not found" } };
  }

  const command = String(input.json?.command ?? "");
  if (command === "prompt") {
    const state = await readState();
    if (!state) return unavailable();
    if (!canSendPrompt(state.phase, roleId)) {
      return {
        status: 403,
        body: { error: "Your role can't send this prompt." },
      };
    }
    const body = String(input.json?.body ?? "").trim();
    if (!body) return { status: 400, body: { error: "Prompt is empty." } };
    const locked = await query(WORKFLOW_SQL.lockPrompt, [WALKTHROUGH_APP_ID]);
    if (!locked[0]) {
      return { status: 409, body: { error: "A prompt is already running." } };
    }
    try {
      await query(WORKFLOW_SQL.insertMessage, [
        input.createId ?? crypto.randomUUID(),
        WALKTHROUGH_CHAT_ID,
        "user",
        body,
      ]);
      let reply = MODEL_FALLBACK;
      try {
        if (typeof input.complete === "function") {
          const text = await input.complete([
            ...state.messages,
            { role: "user", content: body },
          ]);
          if (typeof text === "string" && text.trim()) reply = text.trim();
        }
      } catch {
        reply = MODEL_FALLBACK;
      }
      await query(WORKFLOW_SQL.insertMessage, [
        input.createId ? `${input.createId}-reply` : crypto.randomUUID(),
        WALKTHROUGH_CHAT_ID,
        "assistant",
        reply,
      ]);
    } finally {
      await query(WORKFLOW_SQL.unlockPrompt, [WALKTHROUGH_APP_ID]);
    }
    const next = await snapshot();
    if (!next) return unavailable();
    return { status: 200, body: { snapshot: next } };
  }

  if (command === "transition") {
    const state = await readState();
    if (!state) return unavailable();
    const phase = nextPhase(state.phase, roleId);
    if (!phase) {
      return {
        status: 403,
        body: { error: "Your role can't move this phase." },
      };
    }
    const document =
      phase === "delivered" ? deliveryDocument(state.messages) : null;
    const updated = await query(WORKFLOW_SQL.casPhase, [
      WALKTHROUGH_APP_ID,
      phase,
      state.phase,
      document,
    ]);
    if (!updated[0]) {
      return { status: 409, body: { error: "The phase already changed." } };
    }
    if (phase === "implementation") {
      await query(SQL.insertQuestion, [
        IMPLEMENTATION_QUESTION_ID,
        orgId,
        WALKTHROUGH_APP_ID,
        "implementation",
        WALKTHROUGH_APP_ID,
        "review-approve-dev",
        "developer",
        IMPLEMENTATION_QUESTION_BODY,
        IMPLEMENTATION_QUESTION_ID,
        null,
      ]);
    }
    const next = await snapshot();
    if (!next) return unavailable();
    return { status: 200, body: { snapshot: next } };
  }

  if (command === "answer") {
    const state = await readState();
    if (!state) return unavailable();
    const questionId = String(input.json?.questionId ?? "");
    const question = questionFromRow(
      (await query(SQL.questionById, [questionId]))[0],
    );
    if (!question || question.orgId !== orgId || !isSharedQuestion(question)) {
      return { status: 404, body: { error: "Not found" } };
    }
    if (state.phase !== "implementation") {
      return {
        status: 403,
        body: { error: "Your role can't answer this question." },
      };
    }
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
      const updated = await query(SQL.markAnswered, [
        question.id,
        userId,
        caller.displayName,
        input.now ?? new Date().toISOString(),
      ]);
      if (updated.length > 0) {
        await query(SQL.insertAnswer, [
          input.createId ?? crypto.randomUUID(),
          question.id,
          userId,
          body,
        ]);
        await query(WORKFLOW_SQL.insertMessage, [
          input.createId ? `${input.createId}-answer` : crypto.randomUUID(),
          WALKTHROUGH_CHAT_ID,
          "developer",
          body,
        ]);
      }
    }
    const next = await snapshot();
    if (!next) return unavailable();
    return {
      status: 200,
      body: {
        view: next.questions.find((item) => item.id === question.id) ?? null,
        resolved: false,
        snapshot: next,
      },
    };
  }

  return { status: 404, body: { error: "Not found" } };
}

const phaseButton = "              disabled={!unlocked}";
const approvalGate = "        {showApproval && (";
const approvalGateFixed = "        {false && showApproval && (";
const approvalHint = "        {showApproval && !canApprove && (";
const approvalHintFixed = "        {false && showApproval && !canApprove && (";
const hitlImport = "import { HitlGateList } from './HitlGateList';";
const sharedImport = "import { SharedProject } from './SharedProject';";
const hitlTag = "      <HitlGateList phase={phase} />";
const sharedTag = "      <SharedProject />";
const barImport =
  "import type { FactoryPhaseComment } from '~/lib/factoryRun';";
const hintAnchor =
  '      <p className="mt-2 text-xs text-bolt-elements-textSecondary">';

export function patchSharedProjectBar(source) {
  let next = source;
  if (next.includes(phaseButton)) {
    next = next.replace(phaseButton, "              disabled");
  }
  if (next.includes(approvalGate) && !next.includes(approvalGateFixed)) {
    next = next.replace(approvalGate, approvalGateFixed);
  }
  if (next.includes(approvalHint) && !next.includes(approvalHintFixed)) {
    next = next.replace(approvalHint, approvalHintFixed);
  }
  if (next.includes(hitlImport)) next = next.replace(hitlImport, sharedImport);
  if (next.includes(hitlTag)) next = next.replace(hitlTag, sharedTag);
  if (!next.includes("<SharedProject />")) {
    if (!next.includes(barImport) || !next.includes(hintAnchor)) {
      throw new Error("factory phase bar was not found");
    }
    next = next
      .replace(barImport, `${barImport}\n${sharedImport}`)
      .replace(hintAnchor, `${sharedTag}\n${hintAnchor}`);
  }
  return next;
}

const composerKeydown = `          onKeyDown={(event) => {
            if (event.key === 'Enter') {`;
const composerKeydownFixed = `          onKeyDown={(event) => {
            if (props.walkthrough) {
              return;
            }
            if (event.key === 'Enter') {`;
const composerPlaceholder = `            props.walkthrough
              ? 'Describe the page'`;
const composerPlaceholderFixed = `            props.walkthrough
              ? 'Use the shared project prompt above'`;
const composerTextarea = `        <textarea
          ref={props.textareaRef}`;
const composerTextareaFixed = `        <textarea
          ref={props.textareaRef}
          readOnly={Boolean(props.walkthrough)}`;

export function patchWalkthroughComposer(source) {
  if (
    !source.includes(composerKeydown) &&
    !source.includes("if (props.walkthrough)")
  ) {
    throw new Error("walkthrough composer was not found");
  }
  let next = source;
  if (next.includes(composerKeydown)) {
    next = next.replace(composerKeydown, composerKeydownFixed);
  }
  if (next.includes(composerPlaceholder)) {
    next = next.replace(composerPlaceholder, composerPlaceholderFixed);
  }
  if (!next.includes("readOnly={Boolean(props.walkthrough)}")) {
    if (!next.includes(composerTextarea)) {
      throw new Error("walkthrough composer was not found");
    }
    next = next.replace(composerTextarea, composerTextareaFixed);
  }
  return next;
}

export function workflowServerSource() {
  return `import { clerkOrganizationIds, clerkUser, gateEnv, neonQuery, sessionToken } from '~/lib/hitl/server';

const APP_ID = ${JSON.stringify(WALKTHROUGH_APP_ID)};
const CHAT_ID = ${JSON.stringify(WALKTHROUGH_CHAT_ID)};
const QUESTION_ID = ${JSON.stringify(IMPLEMENTATION_QUESTION_ID)};
const QUESTION_BODY = ${JSON.stringify(IMPLEMENTATION_QUESTION_BODY)};
const MODEL = ${JSON.stringify(DISCOVERY_MODEL)};
const FALLBACK = ${JSON.stringify(MODEL_FALLBACK)};
const PROJECT_SQL = ${JSON.stringify(WORKFLOW_SQL.project)};
const MESSAGES_SQL = ${JSON.stringify(WORKFLOW_SQL.messages)};
const INSERT_MESSAGE_SQL = ${JSON.stringify(WORKFLOW_SQL.insertMessage)};
const LOCK_PROMPT_SQL = ${JSON.stringify(WORKFLOW_SQL.lockPrompt)};
const UNLOCK_PROMPT_SQL = ${JSON.stringify(WORKFLOW_SQL.unlockPrompt)};
const CAS_PHASE_SQL = ${JSON.stringify(WORKFLOW_SQL.casPhase)};
const QUESTIONS_SQL = ${JSON.stringify(WORKFLOW_SQL.questions)};

type RoleId = 'project-manager' | 'developer';
type Query = (sql: string, params: unknown[]) => Promise<Record<string, unknown>[]>;
type Message = { role: string; content: string };
type StoredQuestion = {
  id: string;
  orgId: string;
  phase: string;
  stepId: string;
  targetRoleId: string;
  status: string;
  body: string;
  answeredByName: string | null;
};

function nextPhase(phase: string, roleId: RoleId): string | null {
  if (phase === 'discovery' && roleId === 'project-manager') return 'implementation';
  if (phase === 'implementation' && roleId === 'developer') return 'delivery';
  if (phase === 'delivery' && roleId === 'project-manager') return 'delivered';
  return null;
}

function transitionLabel(phase: string): string | null {
  if (phase === 'discovery') return 'Move to Implementation';
  if (phase === 'implementation') return 'Move to Delivery';
  if (phase === 'delivery') return 'Approve delivery';
  return null;
}

function canSendPrompt(phase: string, roleId: RoleId): boolean {
  return phase === 'discovery' && roleId === 'project-manager';
}

function isSharedQuestion(question: StoredQuestion): boolean {
  return question.phase === 'implementation' && question.stepId === 'review-approve-dev' && question.targetRoleId === 'developer';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function deliveryDocument(messages: Message[]): string {
  const items = messages
    .map((message) => \`<p><strong>\${escapeHtml(message.role)}</strong> \${escapeHtml(message.content)}</p>\`)
    .join('\\n');
  return \`<!doctype html><html><head><meta charset="utf-8"><title>Delivered</title></head><body><h1>Delivered</h1>\\n\${items}\\n</body></html>\`;
}

function presentSnapshot(state: {
  phase: string;
  messages: Message[];
  questions: StoredQuestion[];
  documentHtml: string | null;
}, roleId: RoleId) {
  const next = nextPhase(state.phase, roleId);
  return {
    phase: state.phase,
    messages: state.messages.map((message) => ({ role: message.role, content: message.content })),
    canSend: canSendPrompt(state.phase, roleId),
    canTransition: next != null,
    transitionLabel: next ? transitionLabel(state.phase) : null,
    canDownload: state.phase === 'delivered' && Boolean(state.documentHtml),
    questions: state.questions.filter(isSharedQuestion).map((question) => ({
      id: question.id,
      stepId: question.stepId,
      targetRoleId: question.targetRoleId,
      status: question.status,
      answeredByName: question.answeredByName,
      body: roleId === question.targetRoleId ? question.body : null,
      canAnswer: roleId === 'developer' && question.status === 'open' && state.phase === 'implementation',
    })),
  };
}

async function completePrompt(apiKey: string | undefined, messages: Message[]): Promise<string> {
  const key = apiKey?.trim();
  if (!key) return FALLBACK;
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: \`Bearer \${key}\`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: 'system',
            content: 'Reply with a short Discovery summary. Include the page name, one sentence, and the page contents.',
          },
          ...messages.map((message) => ({
            role: message.role === 'assistant' ? 'assistant' : 'user',
            content: message.content,
          })),
        ],
      }),
    });
    if (!response.ok) return FALLBACK;
    const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const text = payload.choices?.[0]?.message?.content;
    if (!text?.trim()) return FALLBACK;
    return text.trim();
  } catch {
    return FALLBACK;
  }
}

async function readState(query: Query, orgId: string) {
  const rows = await query(PROJECT_SQL, [APP_ID]);
  const row = rows[0];
  if (!row) return null;
  const messages = (await query(MESSAGES_SQL, [CHAT_ID])).map((item) => ({
    role: String(item.role),
    content: String(item.content),
  }));
  const questions = (await query(QUESTIONS_SQL, [orgId, APP_ID])).map((item) => ({
    id: String(item.id),
    orgId: String(item.org_id),
    phase: String(item.phase),
    stepId: String(item.step_id),
    targetRoleId: String(item.target_role_id),
    status: String(item.status),
    body: String(item.body),
    answeredByName: item.answered_by_name == null ? null : String(item.answered_by_name),
  }));
  return {
    phase: String(row.phase),
    documentHtml: row.document_html == null ? null : String(row.document_html),
    messages,
    questions,
  };
}

export async function handleProjectRequest(input: {
  method: string;
  document?: boolean;
  authorization: string | null;
  cookie: string | null;
  json?: unknown;
  env: unknown;
}) {
  const env = gateEnv(input.env);
  const databaseUrl = env.WEWEBPLUS_DATABASE_URL?.trim() ?? '';
  if (!databaseUrl) return { status: 503, body: { error: 'Project store is unavailable.' } };
  const query = (sql: string, params: unknown[]) => neonQuery(databaseUrl, sql, params);
  const machine = env.GAS_CITY_HOST_BRIDGE_TOKEN?.trim() ?? '';
  const token = sessionToken(input.authorization, input.cookie, machine);
  if (!token) return { status: 401, body: { error: 'Sign in to continue.' } };
  let userId = '';
  let displayName = '';
  let activeOrgs: Set<string>;
  try {
    const user = await clerkUser(env, token);
    userId = user.userId;
    displayName = user.displayName;
    activeOrgs = await clerkOrganizationIds(env, user.userId);
  } catch {
    return { status: 401, body: { error: 'Sign in to continue.' } };
  }
  try {
    const apps = await query('select owner_type, owner_id from wewebplus.apps where id = $1', [APP_ID]);
    const app = apps[0];
    if (!app || app.owner_type !== 'org' || !app.owner_id) {
      return { status: 404, body: { error: 'Not found' } };
    }
    const orgId = String(app.owner_id);
    if (!activeOrgs.has(orgId)) return { status: 404, body: { error: 'Not found' } };
    const memberships = await query(
      'select role_id from wewebplus.memberships where user_id = $1 and org_id = $2',
      [userId, orgId],
    );
    const roleRaw = memberships[0]?.role_id;
    const roleId: RoleId | null =
      roleRaw === 'project-manager' || roleRaw === 'developer' ? roleRaw : null;
    if (!roleId) return { status: 404, body: { error: 'Not found' } };
    if (input.document) {
      const state = await readState(query, orgId);
      if (!state || state.phase !== 'delivered' || !state.documentHtml) {
        return { status: 404, body: { error: 'Not found' } };
      }
      return { status: 200, body: state.documentHtml, html: true };
    }
    if (input.method === 'GET') {
      const state = await readState(query, orgId);
      if (!state) return { status: 503, body: { error: 'Project store is unavailable.' } };
      return { status: 200, body: presentSnapshot(state, roleId) };
    }
    if (input.method !== 'POST') return { status: 404, body: { error: 'Not found' } };
    const json = (input.json ?? {}) as { command?: string; body?: string; questionId?: string };
    const command = String(json.command ?? '');
    if (command === 'prompt') {
      const state = await readState(query, orgId);
      if (!state) return { status: 503, body: { error: 'Project store is unavailable.' } };
      if (!canSendPrompt(state.phase, roleId)) {
        return { status: 403, body: { error: "Your role can't send this prompt." } };
      }
      const prompt = String(json.body ?? '').trim();
      if (!prompt) return { status: 400, body: { error: 'Prompt is empty.' } };
      const locked = await query(LOCK_PROMPT_SQL, [APP_ID]);
      if (!locked[0]) return { status: 409, body: { error: 'A prompt is already running.' } };
      try {
        await query(INSERT_MESSAGE_SQL, [crypto.randomUUID(), CHAT_ID, 'user', prompt]);
        const reply = await completePrompt(env.OPEN_ROUTER_API_KEY, [
          ...state.messages,
          { role: 'user', content: prompt },
        ]);
        await query(INSERT_MESSAGE_SQL, [crypto.randomUUID(), CHAT_ID, 'assistant', reply]);
      } finally {
        await query(UNLOCK_PROMPT_SQL, [APP_ID]);
      }
      const next = await readState(query, orgId);
      if (!next) return { status: 503, body: { error: 'Project store is unavailable.' } };
      return { status: 200, body: { snapshot: presentSnapshot(next, roleId) } };
    }
    if (command === 'transition') {
      const state = await readState(query, orgId);
      if (!state) return { status: 503, body: { error: 'Project store is unavailable.' } };
      const phase = nextPhase(state.phase, roleId);
      if (!phase) return { status: 403, body: { error: "Your role can't move this phase." } };
      const document = phase === 'delivered' ? deliveryDocument(state.messages) : null;
      const updated = await query(CAS_PHASE_SQL, [APP_ID, phase, state.phase, document]);
      if (!updated[0]) return { status: 409, body: { error: 'The phase already changed.' } };
      if (phase === 'implementation') {
        await query(
          "insert into wewebplus.questions (id, org_id, app_id, phase, run_id, step_id, target_role_id, visibility, status, body, idempotency_key, bead_id) values ($1, $2, $3, $4, $5, $6, $7, 'role', 'open', $8, $9, $10) on conflict (org_id, idempotency_key) do nothing",
          [QUESTION_ID, orgId, APP_ID, 'implementation', APP_ID, 'review-approve-dev', 'developer', QUESTION_BODY, QUESTION_ID, null],
        );
      }
      const next = await readState(query, orgId);
      if (!next) return { status: 503, body: { error: 'Project store is unavailable.' } };
      return { status: 200, body: { snapshot: presentSnapshot(next, roleId) } };
    }
    if (command === 'answer') {
      const state = await readState(query, orgId);
      if (!state) return { status: 503, body: { error: 'Project store is unavailable.' } };
      const questionId = String(json.questionId ?? '');
      const question = state.questions.find((item) => item.id === questionId);
      if (!question || !isSharedQuestion(question)) {
        return { status: 404, body: { error: 'Not found' } };
      }
      if (state.phase !== 'implementation' || roleId !== question.targetRoleId) {
        return { status: 403, body: { error: "Your role can't answer this question." } };
      }
      const answer = String(json.body ?? '').trim();
      if (question.status === 'open') {
        if (!answer) return { status: 400, body: { error: 'Invalid gate' } };
        const updated = await query(
          "update wewebplus.questions set status = 'answered', answered_by_user_id = $2, answered_by_name = $3, answered_at = now() where id = $1 and status = 'open' returning id",
          [question.id, userId, displayName],
        );
        if (updated.length > 0) {
          await query(
            'insert into wewebplus.answers (id, question_id, user_id, body) values ($1, $2, $3, $4) on conflict (question_id) do nothing',
            [crypto.randomUUID(), question.id, userId, answer],
          );
          await query(INSERT_MESSAGE_SQL, [crypto.randomUUID(), CHAT_ID, 'developer', answer]);
        }
      }
      const next = await readState(query, orgId);
      if (!next) return { status: 503, body: { error: 'Project store is unavailable.' } };
      const view = presentSnapshot(next, roleId);
      return {
        status: 200,
        body: {
          view: view.questions.find((item) => item.id === question.id) ?? null,
          resolved: false,
          snapshot: view,
        },
      };
    }
    return { status: 404, body: { error: 'Not found' } };
  } catch {
    return { status: 503, body: { error: 'Project store is unavailable.' } };
  }
}
`;
}

function projectRouteSource() {
  return `import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { handleProjectRequest } from '~/lib/hitl/workflow';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const result = await handleProjectRequest({
    method: 'GET',
    authorization: request.headers.get('authorization'),
    cookie: request.headers.get('cookie'),
    env: context.cloudflare?.env ?? process.env,
  });
  return Response.json(result.body, { status: result.status });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const json = (await request.json().catch(() => ({}))) as { command?: string };
  const result = await handleProjectRequest({
    method: request.method,
    authorization: request.headers.get('authorization'),
    cookie: request.headers.get('cookie'),
    json,
    env: context.cloudflare?.env ?? process.env,
  });
  return Response.json(result.body, { status: result.status });
}
`;
}

function documentRouteSource() {
  return `import type { LoaderFunctionArgs } from 'react-router';
import { handleProjectRequest } from '~/lib/hitl/workflow';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const result = await handleProjectRequest({
    method: 'GET',
    document: true,
    authorization: request.headers.get('authorization'),
    cookie: request.headers.get('cookie'),
    env: context.cloudflare?.env ?? process.env,
  });
  if (result.html) {
    return new Response(String(result.body), {
      status: result.status,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
  return Response.json(result.body, { status: result.status });
}
`;
}

function sharedProjectSource() {
  return `import { useEffect, useState } from 'react';
import { clerkReady, hitlFetch, onClerkSession } from '~/lib/hitl/client';

interface SharedQuestion {
  id: string;
  stepId: string;
  targetRoleId: string;
  status: string;
  answeredByName: string | null;
  body: string | null;
  canAnswer: boolean;
}

interface Snapshot {
  phase: string;
  messages: { role: string; content: string }[];
  canSend: boolean;
  canTransition: boolean;
  transitionLabel: string | null;
  canDownload: boolean;
  questions: SharedQuestion[];
}

const PHASE_LABEL: Record<string, string> = {
  discovery: 'Discovery',
  implementation: 'Implementation',
  delivery: 'Delivery',
  delivered: 'Delivered',
};

export function SharedProject() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [prompt, setPrompt] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void hitlFetch('/api/project')
        .then(async (response) => {
          if (!response.ok) return null;
          return (await response.json()) as Snapshot;
        })
        .then((next) => {
          if (!cancelled && next?.phase) setSnapshot(next);
        })
        .catch(() => undefined);
    };
    void clerkReady().then((ready) => {
      if (ready && !cancelled) load();
    });
    const stop = onClerkSession(() => {
      if (!cancelled) load();
    });
    const timer = window.setInterval(load, 2000);
    return () => {
      cancelled = true;
      stop();
      window.clearInterval(timer);
    };
  }, []);

  const send = (command: string, extra: Record<string, string> = {}) => {
    if (pending) return;
    setPending(true);
    void hitlFetch('/api/project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, ...extra }),
    })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = (await response.json()) as { snapshot?: Snapshot };
        if (payload.snapshot?.phase) setSnapshot(payload.snapshot);
      })
      .finally(() => setPending(false));
  };

  if (!snapshot) {
    return (
      <p className="mt-2 text-xs text-bolt-elements-textSecondary" data-testid="shared-project">
        Sign in to see the shared project.
      </p>
    );
  }

  return (
    <div className="mt-2 space-y-2" data-testid="shared-project">
      <p className="text-sm text-bolt-elements-textPrimary" data-testid="shared-project-phase">
        {PHASE_LABEL[snapshot.phase] ?? snapshot.phase}
      </p>
      <div className="space-y-1" data-testid="shared-project-transcript">
        {snapshot.messages.map((message, index) => (
          <p key={\`\${message.role}:\${index}\`} className="whitespace-pre-wrap text-sm text-bolt-elements-textPrimary">
            <span className="text-bolt-elements-textSecondary">{message.role}: </span>
            {message.content}
          </p>
        ))}
      </div>
      {snapshot.canSend ? (
        <form
          className="flex flex-wrap items-center gap-2"
          data-testid="shared-project-prompt"
          onSubmit={(event) => {
            event.preventDefault();
            const body = prompt.trim();
            if (!body) return;
            setPrompt('');
            send('prompt', { body });
          }}
        >
          <input
            aria-label="Discovery prompt"
            className="h-8 min-w-0 flex-1 rounded-md border border-bolt-elements-borderColor bg-transparent px-2 text-sm"
            value={prompt}
            placeholder="Describe the page"
            onChange={(event) => setPrompt(event.target.value)}
          />
          <button type="submit" className="rounded-md bg-accent-500 px-2.5 py-1 text-sm text-white" disabled={pending}>
            Send
          </button>
        </form>
      ) : (
        <p className="text-xs text-bolt-elements-textSecondary">You can read this project. Prompts stay with the Project Manager.</p>
      )}
      {snapshot.questions.map((question) => (
        <SharedQuestionCard key={question.id} question={question} pending={pending} onAnswer={(body) => send('answer', { questionId: question.id, body })} />
      ))}
      {snapshot.canTransition && snapshot.transitionLabel ? (
        <button
          type="button"
          className="rounded-md bg-accent-500 px-2.5 py-1 text-sm text-white disabled:opacity-60"
          data-testid="shared-project-transition"
          disabled={pending}
          onClick={() => send('transition')}
        >
          {snapshot.transitionLabel}
        </button>
      ) : null}
      {snapshot.canDownload ? (
        <button
          type="button"
          className="rounded-md border border-bolt-elements-borderColor px-2.5 py-1 text-sm"
          data-testid="shared-project-download"
          onClick={() => {
            void hitlFetch('/api/project/document')
              .then(async (response) => {
                if (!response.ok) return;
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement('a');
                anchor.href = url;
                anchor.download = 'factory-document.html';
                anchor.click();
                URL.revokeObjectURL(url);
              });
          }}
        >
          Download
        </button>
      ) : null}
    </div>
  );
}

function SharedQuestionCard({
  question,
  pending,
  onAnswer,
}: {
  question: SharedQuestion;
  pending: boolean;
  onAnswer: (body: string) => void;
}) {
  const [body, setBody] = useState('');
  const roleLabel = question.targetRoleId === 'developer' ? 'Developer' : 'Project Manager';
  return (
    <div className="rounded-md border border-bolt-elements-borderColor px-2 py-2 text-sm" data-testid={\`shared-question-\${question.id}\`}>
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
            setBody('');
            onAnswer(answer);
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

export function applyBoltWorkflowPatches(boltRoot) {
  const barPath = join(boltRoot, "app/components/factory/FactoryPhaseBar.tsx");
  const bar = readFileSync(barPath, "utf8");
  const patchedBar = patchSharedProjectBar(bar);
  if (patchedBar !== bar) writeFileSync(barPath, patchedBar);
  const chatPath = join(boltRoot, "app/components/chat/ChatBox.tsx");
  const chat = readFileSync(chatPath, "utf8");
  const patchedChat = patchWalkthroughComposer(chat);
  if (patchedChat !== chat) writeFileSync(chatPath, patchedChat);
  mkdirSync(join(boltRoot, "app/lib/hitl"), { recursive: true });
  mkdirSync(join(boltRoot, "app/routes"), { recursive: true });
  mkdirSync(join(boltRoot, "app/components/factory"), { recursive: true });
  writeFileSync(
    join(boltRoot, "app/lib/hitl/workflow.ts"),
    workflowServerSource(),
  );
  writeFileSync(
    join(boltRoot, "app/routes/api.project.ts"),
    projectRouteSource(),
  );
  writeFileSync(
    join(boltRoot, "app/routes/api.project.document.ts"),
    documentRouteSource(),
  );
  writeFileSync(
    join(boltRoot, "app/components/factory/SharedProject.tsx"),
    sharedProjectSource(),
  );
  return [
    `shared_project_patch=${patchedBar === bar ? "already" : "applied"}`,
    `shared_composer_patch=${patchedChat === chat ? "already" : "applied"}`,
    "shared_project_module=written",
  ];
}
