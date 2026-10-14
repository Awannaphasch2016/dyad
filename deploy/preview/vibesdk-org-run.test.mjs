import assert from "node:assert/strict";
import test from "node:test";
import {
  CREATE_REFUSAL,
  DEV_ROLE,
  ENTER_REFUSAL,
  PM_ROLE,
  SECOND_ANSWER,
  WAITING_DEV,
  WAITING_PM,
  acceptTurn,
  assignRole,
  canCreate,
  firstQuestion,
  orgControllerSource,
  orgPopupSource,
  orgRoutesSource,
  orgRunSource,
  patchAppService,
  patchChat,
  patchCodingAgent,
  patchConversationHandler,
  patchUseChat,
  patchUserMessage,
  presentQuestion,
  redactQuestionText,
  turnLabel,
} from "./vibesdk-org-run.mjs";

test("a missing role is kept for the project manager and marked fallback", () => {
  assert.deepEqual(assignRole(undefined), {
    targetRole: PM_ROLE,
    assignment: "fallback",
  });
  assert.deepEqual(assignRole("architect"), {
    targetRole: PM_ROLE,
    assignment: "fallback",
  });
  assert.equal(assignRole(DEV_ROLE).assignment, "declared");
});

test("the other role sees a waiting line and not the question", () => {
  const question = {
    status: "open",
    targetRole: PM_ROLE,
    body: "What should the shop sell?",
  };
  assert.deepEqual(presentQuestion(question, DEV_ROLE), {
    body: null,
    waiting: WAITING_PM,
    canAnswer: false,
  });
  assert.equal(presentQuestion(question, PM_ROLE).body, question.body);
  assert.equal(presentQuestion(question, PM_ROLE).canAnswer, true);
});

test("only the named role's first reply is accepted", () => {
  const open = { status: "open", targetRole: DEV_ROLE, body: "Which page?" };
  assert.equal(
    acceptTurn({ open, role: PM_ROLE, answer: "home" }).allow,
    false,
  );
  assert.equal(
    acceptTurn({ open, role: PM_ROLE, answer: "home" }).message,
    WAITING_DEV,
  );
  assert.equal(
    acceptTurn({ open, role: DEV_ROLE, answer: "  " }).message,
    ENTER_REFUSAL,
  );
  assert.equal(
    acceptTurn({ open, role: DEV_ROLE, answer: "The menu page" }).allow,
    true,
  );
  assert.equal(
    acceptTurn({ open, role: DEV_ROLE, answer: "again", alreadyAnswered: true })
      .message,
    SECOND_ANSWER,
  );
  assert.equal(
    acceptTurn({ open: null, role: PM_ROLE, answer: "later" }).message,
    ENTER_REFUSAL,
  );
});

test("creating an app does not make the creator the owner", () => {
  const source = [
    "import { BaseService } from './BaseService';",
    "        // Fetch user's apps first",
    "        const apps = await readDb",
    "            .select()",
    "            .from(schema.apps)",
    "            .where(eq(schema.apps.userId, userId))",
    "        return {",
    "            exists: true,",
    "            isOwner: app.userId === userId,",
    "            visibility: app.visibility as 'private' | 'public' | null",
    "        };",
    "        if (existingApp[0].userId !== userId) {",
    "            return { success: false, error: 'You can only change visibility of your own apps' };",
    "        }",
    "            if (!ownershipResult.isOwner) {",
    "                return { success: false, error: 'You can only delete your own apps' };",
    "            }",
  ].join("\n");
  const patched = patchAppService(source);
  assert.match(patched, /memberCanAccessApp/);
  assert.match(patched, /isOwner: mayOpen/);
  assert.match(patched, /org_id = /);
  assert.match(patched, /Changing the gallery flag is not available/);
  assert.match(patched, /Deleting an app is not available/);
  assert.equal(patched.includes("your own apps"), false);
  assert.equal(patched.includes("app.userId === userId"), false);
  assert.equal(patched.includes("isOwner: false"), false);
});

test("only the project manager can create an organization app", () => {
  assert.equal(canCreate(PM_ROLE), true);
  assert.equal(canCreate(DEV_ROLE), false);
  assert.equal(canCreate("architect"), false);
});

test("one question is stored and an unknown role falls back", () => {
  const parsed = firstQuestion({
    questions: [
      { question: " What is the shop called? ", targetRole: "architect" },
      { question: "Which file?" },
    ],
  });
  assert.deepEqual(parsed, {
    body: "What is the shop called?",
    targetRole: PM_ROLE,
    assignment: "fallback",
  });
});

test("the other role's transcript loses the question body", () => {
  const body = "What should the shop sell?";
  const hidden = redactQuestionText(
    {
      message: body,
      tool: {
        name: "ask_questions",
        args: { questions: [{ question: body }] },
      },
    },
    DEV_ROLE,
    [{ body, targetRole: PM_ROLE }],
  );
  assert.equal(JSON.stringify(hidden).includes(body), false);
  assert.match(
    JSON.stringify(hidden),
    new RegExp(WAITING_PM.replace(".", "\\.")),
  );
});

test("the generated run does not keep the extra card or a phase", () => {
  const run = orgRunSource();
  const controller = orgControllerSource();
  const routes = orgRoutesSource();
  const popup = orgPopupSource();
  for (const source of [run, controller, routes, popup]) {
    assert.equal(source.includes("hitl_"), false);
    assert.equal(source.includes("phase"), false);
    assert.equal(source.includes("plan-approve"), false);
    assert.equal(source.includes("owner_type"), false);
  }
  assert.match(run, /org_id/);
  assert.match(run, /created_by/);
  assert.match(run, /target_role_id/);
  assert.match(run, /question_id TEXT PRIMARY KEY/);
  assert.match(run, /organizationIdFor/);
  assert.match(run, /if \(!row\?\.org_id\) return member\.role === PM_ROLE/);
  assert.match(run, /row\.org_id !== member\.orgId/);
  assert.equal(run.includes("row.user_id !== userId"), false);
  assert.match(run, new RegExp(CREATE_REFUSAL));
  assert.equal(popup.includes("<input"), false);
  assert.equal(popup.includes("<textarea"), false);
  assert.match(popup, /return null/);
  assert.equal(popup.includes("org-waiting"), false);
  assert.equal(popup.includes("org-question"), false);
  assert.equal(popup.includes("Reply in the prompt box"), false);
  assert.equal(popup.includes('aria-label="Locked"'), false);
  assert.match(routes, /\/api\/org/);
});

test("a human turn shows the account name", () => {
  assert.equal(
    turnLabel("Walkthrough Project Manager"),
    "Walkthrough Project Manager",
  );
  assert.equal(turnLabel("  Ada Lovelace  "), "Ada Lovelace");
  const run = orgRunSource();
  assert.match(run, /function turnLabel\(name: string\): string/);
  assert.match(run, /return name\.trim\(\)/);
  assert.equal(run.includes("' · '"), false);
  assert.match(run, /api\.clerk\.com\/v1\/users\//);
  assert.match(run, /SELECT created_by, original_prompt, title/);
  assert.match(run, /answers\.user_id/);
  assert.equal(run.includes("ALTER TABLE answers ADD"), false);
  assert.equal(run.includes("phase"), false);
});

test("the transcript uses three avatars and one human interaction", () => {
  const chatPatch = patchChat.toString();
  const userPatch = patchUserMessage.toString();
  const run = orgRunSource();
  const popup = orgPopupSource();
  assert.match(userPatch, /org-avatar-pm/);
  assert.match(userPatch, /org-avatar-dev/);
  assert.match(userPatch, /org-response-required/);
  assert.match(userPatch, /Response required/);
  assert.match(userPatch, /Waiting on the Project Manager/);
  assert.match(userPatch, /replaceAll/);
  assert.match(chatPatch, /org-question/);
  assert.match(chatPatch, /orgSeenQuestion/);
  assert.match(chatPatch, /orgPending/);
  assert.match(chatPatch, /AIAvatar/);
  assert.match(chatPatch, /role=\{turn\.role\}/);
  assert.match(chatPatch, /launchTurn\?\.role/);
  assert.equal(popup.includes("org-waiting"), false);
  assert.match(run, /select user_id from wewebplus\.memberships where org_id/);
  assert.match(run, /waiting: waitingLine\(open\.target_role_id\)/);
  assert.match(run, /pending: null/);
  assert.match(run, /return name\.trim\(\)/);
  assert.equal(run.includes("' · '"), false);
  assert.equal(run.includes("ALTER TABLE answers ADD"), false);
  assert.equal(run.includes("phase"), false);
});

test("the create request owes the run before any browser socket", () => {
  const coding = patchCodingAgent(
    [
      'import { AppService, ModelConfigService } from "worker/database";',
      "        this.logger().info(`Agent connected for agent ${this.getAgentId()}`, { connection, ctx });",
      "            updatedAt: new Date()",
      "            });",
      "        this.logger().info(`App saved successfully to database for agent ${this.state.metadata.agentId}`, {",
      "        await this.saveToDatabase();",
      "        ",
      "        return this.state;",
    ].join("\n"),
  );
  const owed = coding.indexOf("shouldBeGenerating: true");
  assert.ok(owed > coding.indexOf("await this.saveToDatabase();"));
  const handler = patchConversationHandler(
    [
      "    createAIMessage,",
      "            case 'conversation_response': {",
      "                // Use concrete conversationId when available; otherwise use placeholder id",
      "                let conversationId = message.conversationId ?? 'conversation_response';",
      "                    setIsInitialStateRestored(true);",
      "                    ",
      "                    if (state.shouldBeGenerating && !isGenerating) {",
      "                        logger.debug('🔄 Reconnected with shouldBeGenerating=true, auto-resuming generation');",
      "                        setIsGenerating(true); ",
      "                        updateStage('code', { status: 'active' });",
      "                        sendWebSocketMessage(websocket, 'generate_all');",
      "                    }",
      "                }",
      "                break;",
    ].join("\n"),
  );
  const restored = handler.indexOf("setIsInitialStateRestored(true);");
  const resume = handler.indexOf(
    "sendWebSocketMessage(websocket, 'generate_all')",
  );
  assert.ok(resume > handler.indexOf("}", restored));
  const chat = patchUseChat(
    [
      "\t\t\t\t\t// Request file generation for new chats only",
      "\t\t\t\t\tif (!disableGenerate && urlChatId === 'new') {",
      "\t\t\t\t\t\tlogger.debug('🔄 Starting code generation for new chat');",
      "\t\t\t\t\t\tsetIsGenerating(true);",
      "\t\t\t\t\t\tsendWebSocketMessage(ws, 'generate_all');",
      "\t\t\t\t\t}",
      "\t\t\t\t\tsendWebSocketMessage(ws, 'get_conversation_state');",
    ].join("\n"),
  );
  assert.equal(chat.includes("sendWebSocketMessage(ws, 'generate_all')"), false);
  assert.match(chat, /get_conversation_state/);
});
