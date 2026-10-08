// Shared Discovery, Implementation, and Delivery project for the bolt preview.
// Postgres is the phase. The page polls it. A question answer does not move it.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
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
    "select id, role, content from wewebplus.messages where chat_id = $1 order by created_at asc",
  insertMessage:
    "insert into wewebplus.messages (id, chat_id, role, content) values ($1, $2, $3, $4) on conflict (id) do nothing",
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

export function waitingLabel(phase, roleId, questions) {
  const open = (questions ?? []).some(
    (question) => isSharedQuestion(question) && question.status === "open",
  );
  if (open && roleId !== "developer") return "Waiting on the Developer.";
  if (phase === "discovery" && roleId === "developer") {
    return "Waiting on the Project Manager.";
  }
  if (phase === "implementation" && roleId === "project-manager") {
    return "Waiting on the Developer.";
  }
  if (phase === "delivery" && roleId === "developer") {
    return "Waiting on the Project Manager.";
  }
  return null;
}

export function canRecordMessages(phase, roleId, messages) {
  const userMessage = (messages ?? []).some(
    (message) => message?.role === "user",
  );
  if (phase === "discovery" && roleId !== "project-manager" && userMessage) {
    return false;
  }
  return true;
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
      id: message.id,
      role: message.role,
      content: message.content,
    })),
    roleId,
    waitingLabel: waitingLabel(phase, roleId, questions),
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
        id: item.id,
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
  if (command === "record") {
    const state = await readState();
    if (!state) return unavailable();
    const incoming = Array.isArray(input.json?.messages)
      ? input.json.messages
      : [];
    if (!canRecordMessages(state.phase, roleId, incoming)) {
      return {
        status: 403,
        body: { error: "Your role can't send this prompt." },
      };
    }
    const stored = incoming.filter((message) => {
      const role = String(message?.role ?? "");
      return (
        String(message?.id ?? "").trim() &&
        String(message?.content ?? "").trim() &&
        (role === "user" || role === "assistant" || role === "developer")
      );
    });
    if (stored.length === 0) {
      return { status: 400, body: { error: "Prompt is empty." } };
    }
    for (const message of stored) {
      await query(WORKFLOW_SQL.insertMessage, [
        String(message.id),
        WALKTHROUGH_CHAT_ID,
        String(message.role),
        String(message.content),
      ]);
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
const hitlImport = "import { HitlGateList } from './HitlGateList';\n";
const hitlTag = "      <HitlGateList phase={phase} />\n";
const sharedImport = "import { SharedProject } from './SharedProject';\n";
const sharedTag = "      <SharedProject />\n";
const barImport =
  "import type { FactoryPhaseComment } from '~/lib/factoryRun';";
const barSessionImport =
  "import { useStore } from '@nanostores/react';\nimport { downloadSharedDocument, sharedSnapshot } from '~/lib/hitl/session';";
const commentState = "  const [comment, setComment] = useState('');";
const commentStateFixed = `  const [comment, setComment] = useState('');
  const shared = useStore(sharedSnapshot);`;
const downloadButton = `        {shared?.canDownload ? (
          <button
            type="button"
            className="rounded-md border border-bolt-elements-borderColor px-2.5 py-1 text-sm"
            data-testid="shared-download"
            onClick={() => {
              void downloadSharedDocument();
            }}
          >
            Download
          </button>
        ) : null}
`;

export function patchSharedPhaseBar(source) {
  let next = source
    .replaceAll(hitlImport, "")
    .replaceAll(hitlTag, "")
    .replaceAll(sharedImport, "")
    .replaceAll(sharedTag, "");
  if (next.includes(phaseButton)) {
    next = next.replace(phaseButton, "              disabled");
  }
  if (next.includes(approvalGate) && !next.includes(approvalGateFixed)) {
    next = next.replace(approvalGate, approvalGateFixed);
  }
  if (next.includes(approvalHint) && !next.includes(approvalHintFixed)) {
    next = next.replace(approvalHint, approvalHintFixed);
  }
  if (!next.includes("sharedSnapshot")) {
    if (!next.includes(barImport)) {
      throw new Error("factory phase bar was not found");
    }
    next = next.replace(barImport, `${barSessionImport}\n${barImport}`);
  }
  if (
    !next.includes("useStore(sharedSnapshot)") &&
    next.includes(commentState)
  ) {
    next = next.replace(commentState, commentStateFixed);
  }
  if (!next.includes('data-testid="shared-download"')) {
    if (!next.includes(approvalGateFixed)) {
      throw new Error("factory phase bar was not found");
    }
    next = next.replace(
      approvalGateFixed,
      `${downloadButton}${approvalGateFixed}`,
    );
  }
  return next;
}

const composerImport = "import { classNames } from '~/utils/classNames';";
const composerImportFixed = `import { sharedSendOpen } from '~/lib/hitl/session';
import { classNames } from '~/utils/classNames';`;
const composerKeydown = `          onKeyDown={(event) => {
            if (event.key === 'Enter') {`;
const composerKeydownFixed = `          onKeyDown={(event) => {
            if (props.walkthrough && !sharedSendOpen()) {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
              }

              return;
            }
            if (event.key === 'Enter') {`;
const composerSend = `              onClick={(event) => {
                if (props.isStreaming) {`;
const composerSendFixed = `              onClick={(event) => {
                if (props.walkthrough && !sharedSendOpen()) {
                  event.preventDefault();
                  return;
                }

                if (props.isStreaming) {`;

export function patchWalkthroughComposer(source) {
  if (
    !source.includes(composerKeydown) &&
    !source.includes("sharedSendOpen()")
  ) {
    throw new Error("walkthrough composer was not found");
  }
  if (!source.includes(composerSend) && !source.includes("sharedSendOpen()")) {
    throw new Error("walkthrough composer was not found");
  }
  let next = source;
  if (!next.includes("sharedSendOpen")) {
    if (!next.includes(composerImport)) {
      throw new Error("walkthrough composer was not found");
    }
    next = next.replace(composerImport, composerImportFixed);
  }
  if (next.includes(composerKeydown)) {
    next = next.replace(composerKeydown, composerKeydownFixed);
  }
  if (next.includes(composerSend)) {
    next = next.replace(composerSend, composerSendFixed);
  }
  return next;
}

const chatImport = "import { BaseChat } from './BaseChat';";
const chatImportFixed = `import { BaseChat } from './BaseChat';
import { recordSharedFinish, useSharedChat } from '~/lib/hitl/session';`;
const chatFinish = `      onFinish: ({ message }) => {
        setProgressAnnotations([]);`;
const chatFinishFixed = `      onFinish: ({ message }) => {
        setProgressAnnotations([]);
        recordSharedFinish(message);`;
const chatReturn = `    return (
      <BaseChat`;
const chatReturnFixed = `    useSharedChat({
      messages,
      setMessages,
      isLoading,
      factoryRun,
      setFactoryRun,
      saveFactoryRun,
      sendMessage,
      setChatStarted,
    });

    return (
      <BaseChat`;

export function patchSharedChat(source) {
  if (!source.includes("useSharedChat(") && !source.includes(chatReturn)) {
    throw new Error("walkthrough chat was not found");
  }
  let next = source;
  if (!next.includes("useSharedChat")) {
    if (!next.includes(chatImport) || !next.includes(chatFinish)) {
      throw new Error("walkthrough chat was not found");
    }
    next = next
      .replace(chatImport, chatImportFixed)
      .replace(chatFinish, chatFinishFixed)
      .replace(chatReturn, chatReturnFixed);
  }
  return next;
}

const baseImport = "import ChatAlert from './ChatAlert';";
const baseImportFixed = `import ChatAlert from './ChatAlert';
import { SharedGateDialog } from '~/components/factory/SharedGateDialog';`;
const baseAnchor = `                {incomingProgressAnnotations && <ProgressCompilation data={incomingProgressAnnotations} />}
                <ChatBox`;
const baseAnchorFixed = `                {incomingProgressAnnotations && <ProgressCompilation data={incomingProgressAnnotations} />}
                {walkthrough ? <SharedGateDialog /> : null}
                <ChatBox`;

export function patchSharedBaseChat(source) {
  if (!source.includes("SharedGateDialog") && !source.includes(baseAnchor)) {
    throw new Error("walkthrough chat layout was not found");
  }
  let next = source;
  if (!next.includes("SharedGateDialog")) {
    if (!next.includes(baseImport)) {
      throw new Error("walkthrough chat layout was not found");
    }
    next = next
      .replace(baseImport, baseImportFixed)
      .replace(baseAnchor, baseAnchorFixed);
  }
  return next;
}

const parserImport = "import { workbenchStore } from '~/lib/stores/workbench';";
const parserImportFixed = `import { sharedReplayIds } from '~/lib/hitl/session';
import { workbenchStore } from '~/lib/stores/workbench';`;
const parserClose = `      if (data.action.type !== 'file') {
        workbenchStore.addAction(data);
      }`;
const parserCloseFixed = `      if (data.action.type !== 'file') {
        if (sharedReplayIds.has(data.messageId)) {
          return;
        }

        workbenchStore.addAction(data);
      }`;

export function patchSharedReplay(source) {
  if (!source.includes("sharedReplayIds") && !source.includes(parserClose)) {
    throw new Error("message parser was not found");
  }
  let next = source;
  if (!next.includes("sharedReplayIds")) {
    if (!next.includes(parserImport)) {
      throw new Error("message parser was not found");
    }
    next = next
      .replace(parserImport, parserImportFixed)
      .replace(parserClose, parserCloseFixed);
  }
  return next;
}

export function workflowServerSource() {
  return `import { clerkOrganizationIds, clerkUser, gateEnv, neonQuery, sessionToken } from '~/lib/hitl/server';

const APP_ID = ${JSON.stringify(WALKTHROUGH_APP_ID)};
const CHAT_ID = ${JSON.stringify(WALKTHROUGH_CHAT_ID)};
const QUESTION_ID = ${JSON.stringify(IMPLEMENTATION_QUESTION_ID)};
const QUESTION_BODY = ${JSON.stringify(IMPLEMENTATION_QUESTION_BODY)};
const PROJECT_SQL = ${JSON.stringify(WORKFLOW_SQL.project)};
const MESSAGES_SQL = ${JSON.stringify(WORKFLOW_SQL.messages)};
const INSERT_MESSAGE_SQL = ${JSON.stringify(WORKFLOW_SQL.insertMessage)};
const CAS_PHASE_SQL = ${JSON.stringify(WORKFLOW_SQL.casPhase)};
const QUESTIONS_SQL = ${JSON.stringify(WORKFLOW_SQL.questions)};

type RoleId = 'project-manager' | 'developer';
type Query = (sql: string, params: unknown[]) => Promise<Record<string, unknown>[]>;
type Message = { id: string; role: string; content: string };
type IncomingMessage = { id?: string; role?: string; content?: string };
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

function waitingLabel(phase: string, roleId: RoleId, questions: StoredQuestion[]): string | null {
  const open = questions.some((question) => isSharedQuestion(question) && question.status === 'open');
  if (open && roleId !== 'developer') return 'Waiting on the Developer.';
  if (phase === 'discovery' && roleId === 'developer') return 'Waiting on the Project Manager.';
  if (phase === 'implementation' && roleId === 'project-manager') return 'Waiting on the Developer.';
  if (phase === 'delivery' && roleId === 'developer') return 'Waiting on the Project Manager.';
  return null;
}

function canRecordMessages(phase: string, roleId: RoleId, messages: IncomingMessage[]): boolean {
  const userMessage = messages.some((message) => message?.role === 'user');
  if (phase === 'discovery' && roleId !== 'project-manager' && userMessage) return false;
  return true;
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
    messages: state.messages.map((message) => ({ id: message.id, role: message.role, content: message.content })),
    roleId,
    waitingLabel: waitingLabel(state.phase, roleId, state.questions),
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

async function readState(query: Query, orgId: string) {
  const rows = await query(PROJECT_SQL, [APP_ID]);
  const row = rows[0];
  if (!row) return null;
  const messages = (await query(MESSAGES_SQL, [CHAT_ID])).map((item) => ({
    id: String(item.id),
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
    const json = (input.json ?? {}) as {
      command?: string;
      body?: string;
      questionId?: string;
      messages?: IncomingMessage[];
    };
    const command = String(json.command ?? '');
    if (command === 'record') {
      const state = await readState(query, orgId);
      if (!state) return { status: 503, body: { error: 'Project store is unavailable.' } };
      const incoming = Array.isArray(json.messages) ? json.messages : [];
      if (!canRecordMessages(state.phase, roleId, incoming)) {
        return { status: 403, body: { error: "Your role can't send this prompt." } };
      }
      const stored = incoming.filter((message) => {
        const role = String(message?.role ?? '');
        return (
          String(message?.id ?? '').trim().length > 0 &&
          String(message?.content ?? '').trim().length > 0 &&
          (role === 'user' || role === 'assistant' || role === 'developer')
        );
      });
      if (stored.length === 0) return { status: 400, body: { error: 'Prompt is empty.' } };
      for (const message of stored) {
        await query(INSERT_MESSAGE_SQL, [
          String(message.id),
          CHAT_ID,
          String(message.role),
          String(message.content),
        ]);
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

function sessionSource() {
  return [
    "import { useEffect } from 'react';",
    "import type { UIEvent } from 'react';",
    "import { atom } from 'nanostores';",
    "import type { FactoryPhase } from '~/lib/factoryPhase';",
    "import type { FactoryRunRecord } from '~/lib/factoryRun';",
    "import { clerkReady, hitlFetch, onClerkSession } from '~/lib/hitl/client';",
    "import { createMessage, getMessageText } from '~/lib/persistence/messageMigration';",
    "import { chatStore } from '~/lib/stores/chat';",
    "",
    "export interface SharedQuestion {",
    "  id: string;",
    "  stepId: string;",
    "  targetRoleId: string;",
    "  status: string;",
    "  answeredByName: string | null;",
    "  body: string | null;",
    "  canAnswer: boolean;",
    "}",
    "",
    "export interface ProjectSnapshot {",
    "  phase: string;",
    "  messages: { id: string; role: string; content: string }[];",
    "  roleId?: string;",
    "  waitingLabel: string | null;",
    "  canSend: boolean;",
    "  canTransition: boolean;",
    "  transitionLabel: string | null;",
    "  canDownload: boolean;",
    "  questions: SharedQuestion[];",
    "}",
    "",
    "type StoredChatMessage = {",
    "  id?: string;",
    "  role?: string;",
    "  content?: unknown;",
    "  parts?: unknown;",
    "};",
    "",
    "export const sharedSnapshot = atom<ProjectSnapshot | null>(null);",
    "export const sharedReplayIds = new Set<string>();",
    "",
    "const messagesRef: { current: StoredChatMessage[] } = { current: [] };",
    "const loadingRef = { current: false };",
    "const factoryRef: { current: FactoryRunRecord } = {",
    "  current: { phase: 'discovery', approved: [], comments: [] },",
    "};",
    "const sendRef: { current: ((event: UIEvent, messageInput?: string) => void) | null } = {",
    "  current: null,",
    "};",
    "",
    "export function sharedSendOpen(): boolean {",
    "  return sharedSnapshot.get()?.canSend === true;",
    "}",
    "",
    "function localFactoryPhase(phase: string): FactoryPhase {",
    "  if (phase === 'implementation') return 'implementation';",
    "  if (phase === 'delivery' || phase === 'delivered') return 'delivery';",
    "  return 'discovery';",
    "}",
    "",
    "function approvedPhases(phase: string): FactoryPhase[] {",
    "  if (phase === 'delivered') return ['discovery', 'implementation', 'delivery'];",
    "  if (phase === 'delivery') return ['discovery', 'implementation'];",
    "  if (phase === 'implementation') return ['discovery'];",
    "  return [];",
    "}",
    "",
    "function samePhases(left: readonly string[], right: readonly string[]): boolean {",
    "  return left.length === right.length && left.every((item, index) => item === right[index]);",
    "}",
    "",
    "function replayRole(role: string): 'user' | 'assistant' | 'system' {",
    "  if (role === 'assistant') return 'assistant';",
    "  if (role === 'system') return 'system';",
    "  return 'user';",
    "}",
    "",
    "function mergeMessages(",
    "  next: ProjectSnapshot,",
    "  setMessages: (messages: any) => void,",
    "  setChatStarted: (started: boolean) => void,",
    ") {",
    "  const local = messagesRef.current;",
    "  const seen = new Set(local.map((message) => message.id).filter((id): id is string => Boolean(id)));",
    "  const unseen = next.messages.filter((message) => message.id && !seen.has(message.id));",
    "  if (unseen.length === 0) return;",
    "  for (const message of unseen) sharedReplayIds.add(message.id);",
    "  const merged = [",
    "    ...local,",
    "    ...unseen.map((message) =>",
    "      createMessage({",
    "        id: message.id,",
    "        role: replayRole(message.role),",
    "        text: message.content,",
    "      }),",
    "    ),",
    "  ];",
    "  messagesRef.current = merged;",
    "  setChatStarted(true);",
    "  chatStore.setKey('started', true);",
    "  setMessages(merged);",
    "}",
    "",
    "function syncPhase(",
    "  next: ProjectSnapshot,",
    "  setFactoryRun: (run: FactoryRunRecord) => void,",
    "  saveFactoryRun: (run: FactoryRunRecord) => Promise<void> | void,",
    ") {",
    "  const phase = localFactoryPhase(next.phase);",
    "  const approved = approvedPhases(next.phase);",
    "  const current = factoryRef.current;",
    "  if (current.phase === phase && samePhases(current.approved, approved)) return;",
    "  const run: FactoryRunRecord = { ...current, phase, approved };",
    "  factoryRef.current = run;",
    "  setFactoryRun(run);",
    "  void saveFactoryRun(run);",
    "}",
    "",
    "export function useSharedChat(input: {",
    "  messages: StoredChatMessage[];",
    "  setMessages: (messages: any) => void;",
    "  isLoading: boolean;",
    "  factoryRun: FactoryRunRecord;",
    "  setFactoryRun: (run: FactoryRunRecord) => void;",
    "  saveFactoryRun: (run: FactoryRunRecord) => Promise<void> | void;",
    "  sendMessage: (event: UIEvent, messageInput?: string) => void;",
    "  setChatStarted: (started: boolean) => void;",
    "}) {",
    "  messagesRef.current = input.messages;",
    "  loadingRef.current = input.isLoading;",
    "  factoryRef.current = input.factoryRun;",
    "  sendRef.current = input.sendMessage;",
    "  const setMessages = input.setMessages;",
    "  const setFactoryRun = input.setFactoryRun;",
    "  const saveFactoryRun = input.saveFactoryRun;",
    "  const setChatStarted = input.setChatStarted;",
    "",
    "  useEffect(() => {",
    "    let cancelled = false;",
    "    const apply = (next: ProjectSnapshot | null) => {",
    "      if (cancelled || !next?.phase) return;",
    "      if (!loadingRef.current) mergeMessages(next, setMessages, setChatStarted);",
    "      syncPhase(next, setFactoryRun, saveFactoryRun);",
    "    };",
    "    const stopStore = sharedSnapshot.subscribe(apply);",
    "    const load = () => {",
    "      void hitlFetch('/api/project')",
    "        .then(async (response) => {",
    "          if (response.status === 401) {",
    "            sharedSnapshot.set(null);",
    "            return null;",
    "          }",
    "          if (!response.ok) return null;",
    "          return (await response.json()) as ProjectSnapshot;",
    "        })",
    "        .then((next) => {",
    "          if (!cancelled && next?.phase) sharedSnapshot.set(next);",
    "        })",
    "        .catch(() => undefined);",
    "    };",
    "    void clerkReady().then((ready) => {",
    "      if (ready && !cancelled) load();",
    "    });",
    "    const stopSession = onClerkSession(() => {",
    "      if (!cancelled) load();",
    "    });",
    "    const timer = window.setInterval(load, 2000);",
    "    return () => {",
    "      cancelled = true;",
    "      stopStore();",
    "      stopSession();",
    "      window.clearInterval(timer);",
    "    };",
    "  }, [setMessages, setFactoryRun, saveFactoryRun, setChatStarted]);",
    "}",
    "",
    "export function recordSharedFinish(message: StoredChatMessage) {",
    "  const local = messagesRef.current;",
    "  const user = [...local].reverse().find((item) => item.role === 'user');",
    "  const stored: { id: string; role: string; content: string }[] = [];",
    "  const userText = user ? getMessageText(user) : '';",
    "  if (user?.id && userText.trim()) {",
    "    stored.push({ id: user.id, role: 'user', content: userText });",
    "  }",
    "  const assistantText = getMessageText(message);",
    "  if (message.id && assistantText.trim()) {",
    "    stored.push({ id: message.id, role: 'assistant', content: assistantText });",
    "  }",
    "  if (stored.length === 0) return;",
    "  void hitlFetch('/api/project', {",
    "    method: 'POST',",
    "    headers: { 'Content-Type': 'application/json' },",
    "    body: JSON.stringify({ command: 'record', messages: stored }),",
    "  }).catch(() => undefined);",
    "}",
    "",
    "export function startBuilderTurn(prompt: string) {",
    "  const send = sendRef.current;",
    "  if (!send || !prompt.trim()) return;",
    "  send({} as UIEvent, prompt);",
    "}",
    "",
    "export async function downloadSharedDocument() {",
    "  const response = await hitlFetch('/api/project/document');",
    "  if (!response.ok) return;",
    "  const blob = await response.blob();",
    "  const url = URL.createObjectURL(blob);",
    "  const anchor = document.createElement('a');",
    "  anchor.href = url;",
    "  anchor.download = 'factory-document.html';",
    "  anchor.click();",
    "  URL.revokeObjectURL(url);",
    "}",
    "",
  ].join("\n");
}

function gateDialogSource() {
  return [
    "import { useState } from 'react';",
    "import { useStore } from '@nanostores/react';",
    "import { Dialog, DialogDescription, DialogRoot, DialogTitle } from '~/components/ui/Dialog';",
    "import { continuePrefill, factoryPhaseKickoff, latestFactoryPhaseSummary } from '~/lib/factoryPhase';",
    "import { hitlFetch } from '~/lib/hitl/client';",
    "import { sharedSnapshot, startBuilderTurn } from '~/lib/hitl/session';",
    "import type { ProjectSnapshot } from '~/lib/hitl/session';",
    "",
    "function kickoffFor(phase: string, messages: { role: string; content: string }[]): string {",
    "  if (phase === 'implementation') {",
    "    return continuePrefill('implementation', latestFactoryPhaseSummary(messages, 'discovery')) ?? '';",
    "  }",
    "  if (phase === 'delivery') {",
    "    return factoryPhaseKickoff('delivery', latestFactoryPhaseSummary(messages, 'implementation')) ?? '';",
    "  }",
    "  return '';",
    "}",
    "",
    "export function SharedGateDialog() {",
    "  const snapshot = useStore(sharedSnapshot);",
    "  const [answer, setAnswer] = useState('');",
    "  const [pending, setPending] = useState(false);",
    "  const open = snapshot?.questions.find((question) => question.status === 'open') ?? null;",
    "  const answered =",
    "    snapshot?.phase === 'implementation'",
    "      ? (snapshot.questions.find((question) => question.status === 'answered') ?? null)",
    "      : null;",
    "  if (!snapshot || snapshot.phase === 'delivered') return null;",
    "  const showTransition = !open && snapshot.canTransition && Boolean(snapshot.transitionLabel);",
    "  const waiting = !open && !showTransition ? snapshot.waitingLabel : null;",
    "  if (!open && !showTransition && !waiting && !answered) return null;",
    "",
    "  const send = (command: string, extra: Record<string, string> = {}) => {",
    "    if (pending) return;",
    "    setPending(true);",
    "    void hitlFetch('/api/project', {",
    "      method: 'POST',",
    "      headers: { 'Content-Type': 'application/json' },",
    "      body: JSON.stringify({ command, ...extra }),",
    "    })",
    "      .then(async (response) => {",
    "        if (!response.ok) return null;",
    "        return (await response.json()) as { snapshot?: ProjectSnapshot };",
    "      })",
    "      .then((payload) => {",
    "        const next = payload?.snapshot;",
    "        if (!next?.phase) return;",
    "        sharedSnapshot.set(next);",
    "        if (command !== 'transition') return;",
    "        const prompt = kickoffFor(next.phase, next.messages);",
    "        if (prompt) startBuilderTurn(prompt);",
    "      })",
    "      .finally(() => setPending(false));",
    "  };",
    "",
    "  const title = open ? 'Implementation review' : showTransition ? (snapshot.transitionLabel ?? 'Shared project') : 'Shared project';",
    "  const answeredLine = answered",
    "    ? answered.answeredByName",
    "      ? 'Answered by ' + answered.answeredByName + '.'",
    "      : 'Answered.'",
    "    : null;",
    "  const description = open",
    "    ? open.canAnswer",
    "      ? open.body",
    "      : snapshot.waitingLabel",
    "    : answeredLine;",
    "",
    "  return (",
    "    <DialogRoot open>",
    '      <Dialog showCloseButton={false} className="w-[420px]">',
    '        <div className="p-6" data-testid="shared-gate">',
    "          <DialogTitle>{title}</DialogTitle>",
    '          {description ? <DialogDescription className="mb-4">{description}</DialogDescription> : null}',
    "          {open?.canAnswer ? (",
    "            <form",
    '              className="flex flex-wrap items-center gap-2"',
    "              onSubmit={(event) => {",
    "                event.preventDefault();",
    "                const body = answer.trim();",
    "                if (!body || pending || !open) return;",
    "                setAnswer('');",
    "                send('answer', { questionId: open.id, body });",
    "              }}",
    "            >",
    "              <input",
    '                aria-label="Implementation answer"',
    '                className="h-8 min-w-0 flex-1 rounded-md border border-bolt-elements-borderColor bg-transparent px-2 text-sm"',
    "                value={answer}",
    "                onChange={(event) => setAnswer(event.target.value)}",
    "              />",
    "              <button",
    '                type="submit"',
    '                className="rounded-md bg-accent-500 px-2.5 py-1 text-sm text-white disabled:opacity-60"',
    "                disabled={pending}",
    "              >",
    "                Submit answer",
    "              </button>",
    "            </form>",
    "          ) : null}",
    "          {showTransition ? (",
    "            <button",
    '              type="button"',
    '              className="rounded-md bg-accent-500 px-2.5 py-1 text-sm text-white disabled:opacity-60"',
    '              data-testid="shared-gate-transition"',
    "              disabled={pending}",
    "              onClick={() => send('transition')}",
    "            >",
    "              {snapshot.transitionLabel}",
    "            </button>",
    "          ) : null}",
    "          {waiting && description !== waiting ? (",
    '            <p className="text-sm text-bolt-elements-textSecondary" data-testid="shared-gate-waiting">',
    "              {waiting}",
    "            </p>",
    "          ) : null}",
    "        </div>",
    "      </Dialog>",
    "    </DialogRoot>",
    "  );",
    "}",
    "",
  ].join("\n");
}

export function applyBoltWorkflowPatches(boltRoot) {
  const read = (path) => readFileSync(path, "utf8");
  const writeIfChanged = (path, next, previous) => {
    if (next !== previous) writeFileSync(path, next);
  };
  const barPath = join(boltRoot, "app/components/factory/FactoryPhaseBar.tsx");
  const bar = read(barPath);
  const patchedBar = patchSharedPhaseBar(bar);
  writeIfChanged(barPath, patchedBar, bar);
  const chatBoxPath = join(boltRoot, "app/components/chat/ChatBox.tsx");
  const chatBox = read(chatBoxPath);
  const patchedChatBox = patchWalkthroughComposer(chatBox);
  writeIfChanged(chatBoxPath, patchedChatBox, chatBox);
  const chatPath = join(boltRoot, "app/components/chat/Chat.client.tsx");
  const chat = read(chatPath);
  const patchedChat = patchSharedChat(chat);
  writeIfChanged(chatPath, patchedChat, chat);
  const basePath = join(boltRoot, "app/components/chat/BaseChat.tsx");
  const base = read(basePath);
  const patchedBase = patchSharedBaseChat(base);
  writeIfChanged(basePath, patchedBase, base);
  const parserPath = join(boltRoot, "app/lib/hooks/useMessageParser.ts");
  const parser = read(parserPath);
  const patchedParser = patchSharedReplay(parser);
  writeIfChanged(parserPath, patchedParser, parser);
  mkdirSync(join(boltRoot, "app/lib/hitl"), { recursive: true });
  mkdirSync(join(boltRoot, "app/routes"), { recursive: true });
  mkdirSync(join(boltRoot, "app/components/factory"), { recursive: true });
  writeFileSync(
    join(boltRoot, "app/lib/hitl/workflow.ts"),
    workflowServerSource(),
  );
  writeFileSync(join(boltRoot, "app/lib/hitl/session.tsx"), sessionSource());
  writeFileSync(
    join(boltRoot, "app/components/factory/SharedGateDialog.tsx"),
    gateDialogSource(),
  );
  writeFileSync(
    join(boltRoot, "app/routes/api.project.ts"),
    projectRouteSource(),
  );
  writeFileSync(
    join(boltRoot, "app/routes/api.project.document.ts"),
    documentRouteSource(),
  );
  for (const stale of ["SharedProject.tsx", "HitlGateList.tsx"]) {
    const stalePath = join(boltRoot, "app/components/factory", stale);
    if (existsSync(stalePath)) unlinkSync(stalePath);
  }
  return [
    `shared_gate_patch=${patchedBar === bar ? "already" : "applied"}`,
    `shared_composer_patch=${patchedChatBox === chatBox ? "already" : "applied"}`,
    "shared_session_module=written",
  ];
}
