// Organization run for the Vibe SDK preview.
// The prompt box already on the page is the only place anyone types.
// The builder's existing question popup shows the question to the named role.
// Memberships are read from wewebplus. The shared apps and questions tables
// are not altered: Electron, hitl-web, and Bolt still use their phase columns.
// This run's app, question, and answer rows live on the Vibe SDK app database.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const PM_ROLE = "project-manager";
export const DEV_ROLE = "developer";
export const WAITING_PM = "Waiting on the Project Manager.";
export const WAITING_DEV = "Waiting on the Developer.";
export const CREATE_REFUSAL =
  "Only the Project Manager can create an organization app.";
export const ENTER_REFUSAL =
  "Enter sends only when a question is addressed to you.";
export const SECOND_ANSWER = "This question already has an answer.";

const ROLES = new Set([PM_ROLE, DEV_ROLE]);

export function assignRole(role) {
  if (ROLES.has(role)) return { targetRole: role, assignment: "declared" };
  return { targetRole: PM_ROLE, assignment: "fallback" };
}

export function waitingLine(role) {
  return role === DEV_ROLE ? WAITING_DEV : WAITING_PM;
}

export function firstQuestion(args) {
  const questions = Array.isArray(args?.questions) ? args.questions : [];
  const first = questions.find((item) => {
    return item && typeof item.question === "string" && item.question.trim();
  });
  if (!first) return null;
  const assigned = assignRole(first.targetRole);
  return {
    body: first.question.trim(),
    targetRole: assigned.targetRole,
    assignment: assigned.assignment,
  };
}

export function presentQuestion(question, role) {
  if (!question || question.status !== "open") {
    return { body: null, waiting: null, canAnswer: false };
  }
  if (question.targetRole === role) {
    return { body: question.body, waiting: null, canAnswer: true };
  }
  return {
    body: null,
    waiting: waitingLine(question.targetRole),
    canAnswer: false,
  };
}

export function canCreate(role) {
  return role === PM_ROLE;
}

export function acceptTurn({ open, role, answer, alreadyAnswered }) {
  const text = String(answer ?? "").trim();
  if (!open || open.status !== "open") {
    return { allow: false, message: ENTER_REFUSAL };
  }
  if (alreadyAnswered) return { allow: false, message: SECOND_ANSWER };
  if (open.targetRole !== role) {
    return { allow: false, message: waitingLine(open.targetRole) };
  }
  if (!text) return { allow: false, message: ENTER_REFUSAL };
  return { allow: true, message: "" };
}

export function redactQuestionText(value, role, questions) {
  const hidden = (questions ?? []).filter((question) => {
    return question && question.body && question.targetRole !== role;
  });
  if (hidden.length === 0) return value;
  const walk = (current) => {
    if (typeof current === "string") {
      let next = current;
      for (const question of hidden) {
        if (next.includes(question.body)) {
          next = next
            .split(question.body)
            .join(waitingLine(question.targetRole));
        }
      }
      return next;
    }
    if (Array.isArray(current)) return current.map(walk);
    if (!current || typeof current !== "object") return current;
    const record = {};
    for (const [key, child] of Object.entries(current)) {
      record[key] = walk(child);
    }
    if (
      record.name === "ask_questions" &&
      record.args &&
      typeof record.args === "object"
    ) {
      const question = firstQuestion(record.args);
      if (question && question.targetRole !== role) {
        record.args = { questions: [] };
        record.result = waitingLine(question.targetRole);
      }
    }
    return record;
  };
  return walk(value);
}

function requireAnchor(source, anchor, label) {
  if (!source.includes(anchor))
    throw new Error(`organization patch missed ${label}`);
}

export function patchRouteIndex(source) {
  const importAnchor = "import { setupAuthRoutes } from './authRoutes';";
  const callAnchor = "    setupAuthRoutes(app);";
  requireAnchor(source, importAnchor, "route import");
  requireAnchor(source, callAnchor, "route call");
  return source
    .replace(
      importAnchor,
      `${importAnchor}\nimport { setupOrgRoutes } from './orgRoutes';`,
    )
    .replace(callAnchor, `${callAnchor}\n    setupOrgRoutes(app);`);
}

export function patchAskQuestionsTool(source) {
  const description =
    "'Ask the user one or more clarifying questions when the request is underspecified or ambiguous.',";
  const custom =
    ".describe('When true, the user may enter a free-text answer not in options.'),";
  requireAnchor(source, description, "ask description");
  requireAnchor(source, custom, "ask custom");
  return source
    .replace(
      description,
      "'Ask exactly one clarifying question. Set targetRole to project-manager for requirements, product, naming, and UX. Set targetRole to developer for files, code, and technical choices. Do not write the question text in your message.',",
    )
    .replace(
      custom,
      `${custom}\n\t\t\t\t\t\ttargetRole: z\n\t\t\t\t\t\t\t.enum(['project-manager', 'developer'])\n\t\t\t\t\t\t\t.optional()\n\t\t\t\t\t\t\t.describe('Who answers. project-manager for requirements and UX. developer for files and code.'),\n`,
    );
}

export function patchThink(source) {
  const field =
    "\tprotected static readonly PROJECT_NAME_PREFIX_MAX_LENGTH = 20;\n";
  const prompt =
    "'2. Call the `ask_questions` tool with all the concise, targeted clarifying questions you need answered. Each question can include predefined options and can allow multiple selections and/or a custom free-text answer.',";
  const importAnchor =
    "import { WebSocketMessageResponses } from '../../constants';";
  const holdReset =
    "\t\tconst conversationId = IdGenerator.generateConversationId();\n";
  const textDelta = `					accumulated.text += delta;
					this.broadcast(WebSocketMessageResponses.CONVERSATION_RESPONSE, {
						message: delta,
						conversationId,
						isStreaming: true,
						isDelta: true,
					});`;
  const finalText = `			if (accumulated.text) {
				this.broadcast(WebSocketMessageResponses.CONVERSATION_RESPONSE, {
					message: accumulated.text,
					conversationId,
					isStreaming: false,
				});
			}`;
  const reasoning = `			case 'reasoning-delta': {
				const delta = (chunk as { delta?: string }).delta;
				if (typeof delta === 'string' && delta.length > 0) {
					this.broadcast(WebSocketMessageResponses.CONVERSATION_RESPONSE, {
						message: '',
						conversationId,
						isStreaming: true,
						reasoning: { delta },
					});
				}
				return;
			}`;
  const toolOutput = `				const toolName = toolNames.get(toolCallId) || 'tool';
				const args = toolInputs.get(toolCallId) || {};
				this.broadcast(WebSocketMessageResponses.CONVERSATION_RESPONSE, {`;
  requireAnchor(source, field, "think field");
  requireAnchor(source, prompt, "think prompt");
  requireAnchor(source, importAnchor, "think import");
  requireAnchor(source, holdReset, "think conversation");
  requireAnchor(source, textDelta, "think text");
  requireAnchor(source, finalText, "think final text");
  requireAnchor(source, reasoning, "think reasoning");
  requireAnchor(source, toolOutput, "think tool output");
  return source
    .replace(
      importAnchor,
      `${importAnchor}\nimport { publishOrganizationQuestion } from '../../../services/org/run';`,
    )
    .replace(field, `${field}\n\tprivate organizationHold = false;\n`)
    .replace(
      prompt,
      "'2. Call the `ask_questions` tool with exactly one question. Set targetRole to project-manager for requirements, product, naming, and UX. Set targetRole to developer for files, code, and technical choices. Do not write the question text in your message.',",
    )
    .replace(holdReset, `\t\tthis.organizationHold = false;\n${holdReset}`)
    .replace(textDelta, "\t\t\t\t\taccumulated.text += delta;")
    .replace(reasoning, "\t\t\tcase 'reasoning-delta':\n\t\t\t\treturn;")
    .replace(
      finalText,
      `			if (accumulated.text && !this.organizationHold) {
				this.broadcast(WebSocketMessageResponses.CONVERSATION_RESPONSE, {
					message: accumulated.text,
					conversationId,
					isStreaming: false,
				});
			}
			this.organizationHold = false;`,
    )
    .replace(
      toolOutput,
      `				const toolName = toolNames.get(toolCallId) || 'tool';
				const args = toolInputs.get(toolCallId) || {};
				if (toolName === 'ask_questions') {
					this.organizationHold = true;
					await publishOrganizationQuestion({
						env: this.env,
						appId: this.getAgentId(),
						sockets: this.getWebSockets(),
						args,
						conversationId,
					});
					return;
				}
				this.broadcast(WebSocketMessageResponses.CONVERSATION_RESPONSE, {`,
    );
}

export function patchAgentController(source) {
  const importAnchor =
    "import { WebSocketMessageResponses } from '../../../agents/constants';";
  const userAnchor = "            const user = context.user!;";
  const socketAnchor = `                const agentInstance = await getAgentStub(env, agentId);

                // Let the agent handle the WebSocket connection directly
                return agentInstance.fetch(request);`;
  const previewAnchor =
    "                if (!user || user.id !== appResult.userId) {";
  requireAnchor(source, importAnchor, "agent import");
  requireAnchor(source, userAnchor, "agent user");
  requireAnchor(source, socketAnchor, "agent socket");
  requireAnchor(source, previewAnchor, "agent preview");
  return source
    .replace(
      importAnchor,
      `${importAnchor}
import { assertProjectManager, authorizeOrganizationSocket, memberCanAccessApp } from '../../../services/org/run';`,
    )
    .replace(
      userAnchor,
      `${userAnchor}
            const manager = await assertProjectManager(env, user.id);
            if (!manager.ok) {
                return CodingAgentController.createErrorResponse(manager.message, 403);
            }`,
    )
    .replace(
      socketAnchor,
      `                const agentInstance = await getAgentStub(env, agentId);
                const tagged = await authorizeOrganizationSocket(env, user.id, agentId, request);
                if (tagged instanceof Response) return tagged;
                return agentInstance.fetch(tagged);`,
    )
    .replace(
      previewAnchor,
      `                const orgMember = user ? await memberCanAccessApp(env, agentId, user.id) : false;
                if (!user || !orgMember) {`,
    );
}

export function patchCodingAgent(source) {
  const importAnchor =
    'import { AppService, ModelConfigService } from "worker/database";';
  const connectAnchor =
    "        this.logger().info(`Agent connected for agent ${this.getAgentId()}`, { connection, ctx });";
  const saveAnchor = `            updatedAt: new Date()
            });
        this.logger().info(\`App saved successfully to database for agent \${this.state.metadata.agentId}\`, {`;
  requireAnchor(source, importAnchor, "coding import");
  requireAnchor(source, connectAnchor, "coding connect");
  requireAnchor(source, saveAnchor, "coding save");
  return source
    .replace(
      importAnchor,
      `${importAnchor}\nimport { claimOrganizationApp, rememberOrganizationRole } from "../../services/org/run";`,
    )
    .replace(
      connectAnchor,
      `${connectAnchor}\n        rememberOrganizationRole(connection as unknown as WebSocket, ctx.request);`,
    )
    .replace(
      saveAnchor,
      `            updatedAt: new Date()
            });
        await claimOrganizationApp(this.env, this.state.metadata.agentId, this.state.metadata.userId);
        this.logger().info(\`App saved successfully to database for agent \${this.state.metadata.agentId}\`, {`,
    );
}

export function patchWebsocket(source) {
  const importAnchor = "import { Connection } from 'agents';";
  const suggestAnchor =
    "                agent.handleUserInput(parsedMessage.message, parsedMessage.images).catch((error: unknown) => {";
  const stateAnchor = `                    sendToConnection(connection, WebSocketMessageResponses.CONVERSATION_STATE, {
                        state,
                        deepDebugSession: debugState
                    });`;
  requireAnchor(source, importAnchor, "socket import");
  requireAnchor(source, suggestAnchor, "socket suggestion");
  requireAnchor(source, stateAnchor, "socket state");
  return source
    .replace(
      importAnchor,
      `${importAnchor}\nimport { acceptOrganizationAnswer, redactConversation } from '../../services/org/run';`,
    )
    .replace(
      suggestAnchor,
      `                const turn = await acceptOrganizationAnswer(agent.env, agent.getAgentId(), connection as unknown as WebSocket, parsedMessage.message);
                if (!turn.allow) {
                    sendError(connection, turn.message);
                    return;
                }
                agent.handleUserInput(parsedMessage.message, parsedMessage.images).catch((error: unknown) => {`,
    )
    .replace(
      stateAnchor,
      `                    const visible = await redactConversation(agent.env, agent.getAgentId(), connection as unknown as WebSocket, state);
                    sendToConnection(connection, WebSocketMessageResponses.CONVERSATION_STATE, {
                        state: visible,
                        deepDebugSession: debugState
                    });`,
    );
}

export function patchAppService(source) {
  const importAnchor = "import { BaseService } from './BaseService';";
  const ownerAnchor = `        return {
            exists: true,
            isOwner: app.userId === userId,
            visibility: app.visibility as 'private' | 'public' | null
        };`;
  const listAnchor = `        // Fetch user's apps first
        const apps = await readDb
            .select()
            .from(schema.apps)
            .where(eq(schema.apps.userId, userId))`;
  const galleryAnchor = `        if (existingApp[0].userId !== userId) {
            return { success: false, error: 'You can only change visibility of your own apps' };
        }`;
  const deleteAnchor = `            if (!ownershipResult.isOwner) {
                return { success: false, error: 'You can only delete your own apps' };
            }`;
  requireAnchor(source, importAnchor, "app import");
  requireAnchor(source, ownerAnchor, "app owner");
  requireAnchor(source, listAnchor, "app list");
  requireAnchor(source, galleryAnchor, "gallery update");
  requireAnchor(source, deleteAnchor, "app delete");
  return source
    .replace(
      importAnchor,
      `${importAnchor}\nimport { memberCanAccessApp, organizationIdFor } from '../../services/org/run';`,
    )
    .replace(
      ownerAnchor,
      `        const mayOpen = await memberCanAccessApp(this.env, appId, userId);
        return {
            exists: true,
            isOwner: mayOpen,
            visibility: app.visibility as 'private' | 'public' | null
        };`,
    )
    .replace(
      listAnchor,
      `        const orgId = await organizationIdFor(this.env, userId);
        const apps = await readDb
            .select()
            .from(schema.apps)
            .where(orgId ? sql\`org_id = \${orgId}\` : eq(schema.apps.userId, userId))`,
    )
    .replace(
      galleryAnchor,
      `        return { success: false, error: 'Changing the gallery flag is not available.' };`,
    )
    .replace(
      deleteAnchor,
      `            return { success: false, error: 'Deleting an app is not available.' };`,
    );
}

export function patchHome(source) {
  const createAnchor =
    "\tconst handleCreateApp = (query: string, mode: ProjectType) => {\n";
  requireAnchor(source, createAnchor, "home create");
  if (source.includes("HitlRun"))
    throw new Error("home still mounts the extra card");
  return source.replace(
    createAnchor,
    `${createAnchor}\t\tconst sharedRole = sessionStorage.getItem('vibesdk-shared-role') ?? '';\n\t\tif (sharedRole.includes('Developer')) return;\n`,
  );
}

export function patchChat(source) {
  const disabledAnchor = "\tconst isChatDisabled = useMemo(() => {";
  const disabledEnd = "\t}, [projectStages, isDebugging]);";
  const popupAnchor = `\t\t\t\t\t\t\taboveContent={
\t\t\t\t\t\t\t\t<ClarifyingQuestionsPopup
\t\t\t\t\t\t\t\t\tquestions={clarifyingQuestions ?? []}
\t\t\t\t\t\t\t\t\topen={
\t\t\t\t\t\t\t\t\t\tclarifyingQuestions !== null &&
\t\t\t\t\t\t\t\t\t\tclarifyingQuestions.length > 0
\t\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t\t\tonSubmit={submitClarifyingAnswers}
\t\t\t\t\t\t\t\t\tonDismiss={dismissClarifyingQuestions}
\t\t\t\t\t\t\t\t/>
\t\t\t\t\t\t\t}`;
  requireAnchor(source, disabledAnchor, "chat disabled");
  requireAnchor(source, disabledEnd, "chat disabled end");
  const unusedQuestion = "\t\tclarifyingQuestions,\n";
  requireAnchor(source, unusedQuestion, "chat question state");
  requireAnchor(source, popupAnchor, "chat popup");
  source = source.replace(unusedQuestion, "");
  const start = source.indexOf(disabledAnchor);
  const end = source.indexOf(disabledEnd, start);
  const replaced = `${source.slice(0, start)}\tconst [orgBody, setOrgBody] = useState('');
\tconst [orgWaiting, setOrgWaiting] = useState('');
\tuseEffect(() => {
\t\tif (!urlChatId) return;
\t\tlet stop = false;
\t\tconst look = async () => {
\t\t\tconst response = await fetch(\`/api/org/question?appId=\${encodeURIComponent(urlChatId)}\`, { credentials: 'include' });
\t\t\tif (!response.ok) return;
\t\t\tconst payload = await response.json();
\t\t\tif (stop) return;
\t\t\tsetOrgBody(typeof payload?.data?.body === 'string' ? payload.data.body : '');
\t\t\tsetOrgWaiting(typeof payload?.data?.waiting === 'string' ? payload.data.waiting : '');
\t\t};
\t\tvoid look();
\t\tconst timer = window.setInterval(() => void look(), 2000);
\t\treturn () => {
\t\t\tstop = true;
\t\t\twindow.clearInterval(timer);
\t\t};
\t}, [urlChatId]);
\tconst isChatDisabled = useMemo(() => {
\t\tif (orgBody) return false;
\t\treturn true;
\t}, [orgBody]);${source.slice(end + disabledEnd.length)}`;
  const badgeAnchor = `\t{app?.visibility && (
						<Badge
							className="shrink-0"
							variant={
								app.visibility === 'private'
									? 'secondary'
									: 'success'
							}
						>
							<span className="inline-flex items-center gap-1">
								<Globe className="h-3 w-3" weight="duotone" />
								{capitalizeFirstLetter(app.visibility)}
							</span>
						</Badge>
					)}`;
  const ownerAnchor = "\tconst isOwner = !!app && app.userId === user?.id;";
  requireAnchor(replaced, badgeAnchor, "chat gallery chip");
  requireAnchor(replaced, ownerAnchor, "chat owner");
  return replaced
    .replace(ownerAnchor, "\tconst isOwner = false;")
    .replace(badgeAnchor, "")
    .replace(
      popupAnchor,
      `\t\t\t\t\t\t\taboveContent={
\t\t\t\t\t\t\t\t<>
\t\t\t\t\t\t\t\t\t{orgWaiting ? (
\t\t\t\t\t\t\t\t\t\t<p data-testid="org-waiting" className="px-4 pb-2 text-sm">{orgWaiting}</p>
\t\t\t\t\t\t\t\t\t) : null}
\t\t\t\t\t\t\t\t\t<ClarifyingQuestionsPopup
\t\t\t\t\t\t\t\t\t\tquestions={orgBody ? [{ question: orgBody }] : []}
\t\t\t\t\t\t\t\t\t\topen={Boolean(orgBody)}
\t\t\t\t\t\t\t\t\t\tonSubmit={submitClarifyingAnswers}
\t\t\t\t\t\t\t\t\t\tonDismiss={dismissClarifyingQuestions}
\t\t\t\t\t\t\t\t\t/>
\t\t\t\t\t\t\t\t</>
\t\t\t\t\t\t\t}`,
    );
}

export function patchSidebar(source) {
  const pathAnchor =
    "\tconst getAppPath = (app: App) =>\n\t\tapp.userId === user?.id ? `/chat/${app.id}` : `/app/${app.id}`;";
  const iconAnchor =
    "\tconst getVisibilityIcon = (visibility: App['visibility']) => {";
  requireAnchor(source, pathAnchor, "sidebar path");
  requireAnchor(source, iconAnchor, "sidebar icon");
  const iconEnd = source.indexOf(iconAnchor);
  const iconClose = source.indexOf("\n\t};", iconEnd);
  if (iconClose < 0)
    throw new Error("organization patch missed sidebar icon end");
  return (
    source.slice(0, iconEnd) +
    "\tconst getVisibilityIcon = (_visibility: App['visibility']) => null;" +
    source.slice(iconClose + "\n\t};".length)
  ).replace(
    pathAnchor,
    `\tconst sharedRole = sessionStorage.getItem('vibesdk-shared-role') ?? '';
	const getAppPath = (app: App) =>
		sharedRole.includes('Project Manager') || sharedRole.includes('Developer') || app.userId === user?.id
			? \`/chat/\${app.id}\`
			: \`/app/\${app.id}\`;`,
  );
}

export function patchAppsHook(source) {
  const anchor = "\t\tqueryFn: fetchUserApps,\n\t\tenabled: !!user,";
  requireAnchor(source, anchor, "apps hook");
  return source.replaceAll(
    anchor,
    `\t\tqueryFn: fetchUserApps,
		enabled: !!user,
		refetchInterval: () =>
			sessionStorage.getItem('vibesdk-shared-role') ? 2000 : false,`,
  );
}

export function patchAppView(source) {
  const importAnchor =
    "import { AppService } from '../../../database/services/AppService';";
  const privateAnchor =
    "            if (appResult.visibility === 'private' && appResult.userId !== userId) {\n                return AppViewController.createErrorResponse<AppDetailsData>('App not found', 404);\n            }";
  requireAnchor(source, importAnchor, "app view import");
  requireAnchor(source, privateAnchor, "app view private");
  return source
    .replace(
      importAnchor,
      `${importAnchor}\nimport { memberCanAccessApp } from '../../../services/org/run';`,
    )
    .replace(
      privateAnchor,
      `            const orgMember = userId ? await memberCanAccessApp(env, appId, userId) : false;
            if (appResult.visibility === 'private' && !orgMember) {
                return AppViewController.createErrorResponse<AppDetailsData>('App not found', 404);
            }`,
    );
}

export function patchAppsController(source) {
  const galleryAnchor =
    "result.error?.includes('only change visibility of your own apps') ? 403 : 500;";
  const deleteAnchor =
    "result.error?.includes('only delete your own apps') ? 403 : 500;";
  requireAnchor(source, galleryAnchor, "gallery status");
  requireAnchor(source, deleteAnchor, "delete status");
  return source
    .replace(
      galleryAnchor,
      "result.error?.includes('not available') ? 403 : 500;",
    )
    .replace(
      deleteAnchor,
      "result.error?.includes('not available') ? 403 : 500;",
    );
}

export function orgRunSource() {
  return `// Organization ownership for the Vibe SDK app row.
// A question stores a role and a body.

const PM_ROLE = 'project-manager';
const DEV_ROLE = 'developer';

type Actor = { role: string; userId: string; orgId: string };
type GateRow = { org_id?: string; role_id?: string };
type QuestionRecord = {
	id: string;
	org_id: string;
	app_id: string;
	target_role_id: string;
	body: string;
	status: string;
	assignment: string;
};

let schemaReady: Promise<void> | null = null;

function waitingLine(role: string): string {
	return role === DEV_ROLE ? 'Waiting on the Developer.' : 'Waiting on the Project Manager.';
}

function assignRole(role: unknown): { targetRole: string; assignment: string } {
	if (role === PM_ROLE || role === DEV_ROLE) return { targetRole: role, assignment: 'declared' };
	return { targetRole: PM_ROLE, assignment: 'fallback' };
}

function firstQuestion(args: Record<string, unknown> | undefined): { body: string; targetRole: string; assignment: string } | null {
	const questions = Array.isArray(args?.questions) ? args.questions : [];
	const first = questions.find((item) => {
		return Boolean(item) && typeof item === 'object' && typeof (item as { question?: unknown }).question === 'string' && String((item as { question: string }).question).trim();
	}) as { question?: string; targetRole?: string } | undefined;
	if (!first?.question) return null;
	const assigned = assignRole(first.targetRole);
	return { body: first.question.trim(), targetRole: assigned.targetRole, assignment: assigned.assignment };
}

function send(connection: WebSocket, data: Record<string, unknown>): void {
	try {
		connection.send(JSON.stringify({ type: 'conversation_response', ...data }));
	} catch {
		// A closed socket does not receive the question.
	}
}

const actorsByConnection = new Map<string, Actor>();

function actorFrom(value: unknown): Actor | null {
	if (!value || typeof value !== 'object') return null;
	const record = value as Record<string, unknown>;
	const role = typeof record.role === 'string' ? record.role : '';
	const userId = typeof record.userId === 'string' ? record.userId : '';
	const orgId = typeof record.orgId === 'string' ? record.orgId : '';
	if (role !== PM_ROLE && role !== DEV_ROLE) return null;
	if (!userId) return null;
	return { role, userId, orgId };
}

export function rememberOrganizationRole(connection: WebSocket, request: Request): void {
	const actor = actorFrom({
		role: request.headers.get('x-org-role') ?? '',
		userId: request.headers.get('x-org-user') ?? '',
		orgId: request.headers.get('x-org-id') ?? '',
	});
	if (!actor) return;
	const socket = connection as WebSocket & { id?: string; setState?: (value: Actor) => void };
	if (socket.id) actorsByConnection.set(socket.id, actor);
	socket.setState?.(actor);
}

export function readOrganizationRole(connection: WebSocket): Actor | null {
	const socket = connection as WebSocket & {
		id?: string;
		state?: unknown;
		deserializeAttachment?: () => unknown;
	};
	if (socket.id) {
		const remembered = actorsByConnection.get(socket.id);
		if (remembered) return remembered;
	}
	const fromState = actorFrom(socket.state);
	if (fromState) return fromState;
	const attachment = socket.deserializeAttachment?.();
	if (attachment && typeof attachment === 'object' && '__user' in attachment) {
		return actorFrom((attachment as { __user?: unknown }).__user);
	}
	return actorFrom(attachment);
}

function binding(env: Env, name: string): string {
	const value = (env as unknown as Record<string, unknown>)[name];
	return typeof value === 'string' ? value : '';
}

async function neonQuery(databaseUrl: string, query: string, params: string[]): Promise<GateRow[]> {
	const endpoint = new URL(databaseUrl);
	const host = endpoint.hostname.replace('-pooler.', '.');
	endpoint.hostname = host;
	const response = await fetch('https://' + host + '/sql', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Neon-Connection-String': endpoint.toString(),
		},
		body: JSON.stringify({ query, params }),
	});
	if (!response.ok) return [];
	const payload = await response.json() as { fields?: { name: string }[]; rows?: unknown[] };
	const fields = payload.fields ?? [];
	return (payload.rows ?? []).map((row) => {
		if (!Array.isArray(row)) return row as GateRow;
		const record: GateRow = {};
		fields.forEach((field, index) => {
			(record as Record<string, unknown>)[field.name] = row[index];
		});
		return record;
	});
}

async function membership(env: Env, userId: string): Promise<{ orgId: string; role: string } | null> {
	const databaseUrl = binding(env, 'WEWEBPLUS_DATABASE_URL');
	if (!databaseUrl || !userId) return null;
	const rows = await neonQuery(
		databaseUrl,
		'select org_id, role_id from wewebplus.memberships where user_id = $1',
		[userId],
	);
	const usable = rows.filter((row) => row.role_id === PM_ROLE || row.role_id === DEV_ROLE);
	if (usable.length !== 1 || !usable[0].org_id || !usable[0].role_id) return null;
	return { orgId: String(usable[0].org_id), role: String(usable[0].role_id) };
}

export function ensureOrganizationSchema(env: Env): Promise<void> {
	if (!schemaReady) {
		schemaReady = applySchema(env).catch((error) => {
			schemaReady = null;
			throw error;
		});
	}
	return schemaReady;
}

async function applySchema(env: Env): Promise<void> {
	const statements = [
		'ALTER TABLE apps ADD COLUMN org_id TEXT',
		'ALTER TABLE apps ADD COLUMN created_by TEXT',
		'CREATE TABLE IF NOT EXISTS questions (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, app_id TEXT NOT NULL, target_role_id TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL, assignment TEXT NOT NULL, created_at INTEGER NOT NULL)',
		'CREATE TABLE IF NOT EXISTS answers (question_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL)',
	];
	for (const statement of statements) {
		try {
			await env.DB.prepare(statement).run();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (!/duplicate column/i.test(message)) throw error;
		}
	}
}

export async function assertProjectManager(env: Env, userId: string): Promise<{ ok: true; message: '' } | { ok: false; message: string }> {
	const member = await membership(env, userId);
	if (!member || member.role !== PM_ROLE) {
		return { ok: false, message: 'Only the Project Manager can create an organization app.' };
	}
	return { ok: true, message: '' };
}

export async function claimOrganizationApp(env: Env, appId: string, userId: string): Promise<void> {
	await ensureOrganizationSchema(env);
	const member = await membership(env, userId);
	if (!member || member.role !== PM_ROLE) {
		throw new Error('Only the Project Manager can create an organization app.');
	}
	await env.DB.prepare('UPDATE apps SET org_id = ?, created_by = ? WHERE id = ?').bind(member.orgId, userId, appId).run();
}

export async function organizationIdFor(env: Env, userId: string): Promise<string | null> {
	await ensureOrganizationSchema(env);
	const member = await membership(env, userId);
	return member?.orgId ?? null;
}

export async function memberCanAccessApp(env: Env, appId: string, userId: string): Promise<boolean> {
	await ensureOrganizationSchema(env);
	const member = await membership(env, userId);
	if (!member) return false;
	const row = await env.DB.prepare('SELECT org_id FROM apps WHERE id = ?').bind(appId).first<{ org_id: string | null }>();
	if (!row?.org_id) return member.role === PM_ROLE;
	return row.org_id === member.orgId;
}

export async function authorizeOrganizationSocket(env: Env, userId: string, appId: string, request: Request): Promise<Request | Response> {
	const member = await membership(env, userId);
	if (!member) return new Response('Forbidden', { status: 403 });
	await ensureOrganizationSchema(env);
	const row = await env.DB.prepare('SELECT org_id FROM apps WHERE id = ?').bind(appId).first<{ org_id: string | null }>();
	if (!row || !row.org_id) {
		if (member.role !== PM_ROLE) return new Response('Forbidden', { status: 403 });
	} else if (row.org_id !== member.orgId) {
		return new Response('Not found', { status: 404 });
	}
	const headers = new Headers(request.headers);
	headers.delete('x-org-role');
	headers.delete('x-org-user');
	headers.delete('x-org-id');
	headers.set('x-org-role', member.role);
	headers.set('x-org-user', userId);
	headers.set('x-org-id', member.orgId);
	return new Request(request, { headers });
}

export async function latestOrganizationApp(env: Env, userId: string): Promise<{ id: string; title: string } | null> {
	await ensureOrganizationSchema(env);
	const member = await membership(env, userId);
	if (!member) return null;
	return await env.DB.prepare('SELECT id, title FROM apps WHERE org_id = ? ORDER BY created_at DESC LIMIT 1').bind(member.orgId).first<{ id: string; title: string }>();
}

export async function openOrganizationQuestion(env: Env, userId: string, appId: string): Promise<{ body: string | null; waiting: string | null } | null> {
	await ensureOrganizationSchema(env);
	const member = await membership(env, userId);
	if (!member || !appId) return null;
	const app = await env.DB.prepare('SELECT org_id FROM apps WHERE id = ?').bind(appId).first<{ org_id: string | null }>();
	if (!app?.org_id || app.org_id !== member.orgId) return null;
	const open = await env.DB.prepare("SELECT target_role_id, body, status FROM questions WHERE app_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1").bind(appId).first<{ target_role_id: string; body: string; status: string }>();
	if (!open) return { body: null, waiting: null };
	if (open.target_role_id === member.role) return { body: open.body, waiting: null };
	return { body: null, waiting: waitingLine(open.target_role_id) };
}

export async function publishOrganizationQuestion(input: {
	env: Env;
	appId: string;
	sockets: WebSocket[];
	args: Record<string, unknown>;
	conversationId: string;
}): Promise<void> {
	const question = firstQuestion(input.args);
	if (!question) return;
	await ensureOrganizationSchema(input.env);
	const app = await input.env.DB.prepare('SELECT org_id, user_id FROM apps WHERE id = ?').bind(input.appId).first<{ org_id: string | null; user_id: string | null }>();
	let orgId = app?.org_id ?? '';
	if (!orgId && app?.user_id) {
		const member = await membership(input.env, app.user_id);
		orgId = member?.orgId ?? '';
	}
	const existing = await input.env.DB.prepare("SELECT id, target_role_id, body FROM questions WHERE app_id = ? AND status = 'open' LIMIT 1").bind(input.appId).first<QuestionRecord>();
	let stored = existing;
	if (!stored && orgId) {
		const id = crypto.randomUUID();
		await input.env.DB.prepare('INSERT INTO questions (id, org_id, app_id, target_role_id, body, status, assignment, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, orgId, input.appId, question.targetRole, question.body, 'open', question.assignment, Date.now()).run();
		stored = { id, org_id: orgId, app_id: input.appId, target_role_id: question.targetRole, body: question.body, status: 'open', assignment: question.assignment };
	}
	const targetRole = stored?.target_role_id ?? question.targetRole;
	const body = stored?.body ?? question.body;
	for (const socket of input.sockets) {
		const actor = readOrganizationRole(socket);
		if (actor?.role === targetRole) {
			send(socket, {
				message: '',
				conversationId: input.conversationId,
				isStreaming: false,
				tool: { name: 'ask_questions', status: 'success', args: { questions: [{ question: body }] } },
			});
		} else {
			send(socket, {
				message: waitingLine(targetRole),
				conversationId: input.conversationId,
				isStreaming: false,
			});
		}
	}
}

export async function acceptOrganizationAnswer(env: Env, appId: string, connection: WebSocket, message: string): Promise<{ allow: boolean; message: string }> {
	await ensureOrganizationSchema(env);
	const actor = readOrganizationRole(connection);
	const text = message.trim();
	const open = await env.DB.prepare("SELECT id, target_role_id, status FROM questions WHERE app_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1").bind(appId).first<{ id: string; target_role_id: string; status: string }>();
	if (!open || !actor) return { allow: false, message: 'Enter sends only when a question is addressed to you.' };
	if (open.target_role_id !== actor.role) return { allow: false, message: waitingLine(open.target_role_id) };
	if (!text) return { allow: false, message: 'Enter sends only when a question is addressed to you.' };
	try {
		await env.DB.prepare('INSERT INTO answers (question_id, user_id, body, created_at) VALUES (?, ?, ?, ?)').bind(open.id, actor.userId, text, Date.now()).run();
	} catch {
		return { allow: false, message: 'This question already has an answer.' };
	}
	await env.DB.prepare("UPDATE questions SET status = 'answered' WHERE id = ? AND status = 'open'").bind(open.id).run();
	return { allow: true, message: '' };
}

export async function redactConversation(env: Env, appId: string, connection: WebSocket, state: unknown): Promise<unknown> {
	await ensureOrganizationSchema(env);
	const actor = readOrganizationRole(connection);
	const rows = await env.DB.prepare('SELECT body, target_role_id FROM questions WHERE app_id = ?').bind(appId).all<{ body: string; target_role_id: string }>();
	const hidden = (rows.results ?? []).filter((row) => row.target_role_id !== actor?.role);
	return stripBodies(state, hidden);
}

function stripBodies(value: unknown, hidden: { body: string; target_role_id: string }[]): unknown {
	if (hidden.length === 0) return value;
	const walk = (current: unknown): unknown => {
		if (typeof current === 'string') {
			let next = current;
			for (const question of hidden) {
				if (question.body && next.includes(question.body)) next = next.split(question.body).join(waitingLine(question.target_role_id));
			}
			return next;
		}
		if (Array.isArray(current)) return current.map(walk);
		if (!current || typeof current !== 'object') return current;
		const record: Record<string, unknown> = {};
		for (const [key, child] of Object.entries(current as Record<string, unknown>)) record[key] = walk(child);
		if (record.name === 'ask_questions' && record.args && typeof record.args === 'object') {
			const args = record.args as Record<string, unknown>;
			const questions = Array.isArray(args.questions) ? args.questions : [];
			args.questions = questions.filter((item) => {
				if (!item || typeof item !== 'object') return false;
				const text = (item as { question?: unknown }).question;
				return typeof text === 'string' && !hidden.some((question) => question.body === text);
			});
		}
		return record;
	};
	return walk(value);
}
`;
}

export function orgControllerSource() {
  return `import { BaseController } from '../baseController';
import type { RouteContext } from '../../types/route-context';
import { latestOrganizationApp, openOrganizationQuestion } from '../../../services/org/run';

export class OrgController extends BaseController {
	static async currentApp(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext) {
		const user = context.user;
		if (!user) return OrgController.createErrorResponse('Authentication required', 401);
		const app = await latestOrganizationApp(env, user.id);
		return OrgController.createSuccessResponse(app ?? null);
	}

	static async question(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext) {
		const user = context.user;
		if (!user) return OrgController.createErrorResponse('Authentication required', 401);
		const appId = new URL(request.url).searchParams.get('appId') ?? '';
		const view = await openOrganizationQuestion(env, user.id, appId);
		if (!view) return OrgController.createErrorResponse('Not found', 404);
		return OrgController.createSuccessResponse(view);
	}
}
`;
}

export function orgRoutesSource() {
  return `import { Hono } from 'hono';
import { AppEnv } from '../../types/appenv';
import { adaptController } from '../honoAdapter';
import { AuthConfig, setAuthLevel } from '../../middleware/auth/routeAuth';
import { OrgController } from '../controllers/org/controller';

export function setupOrgRoutes(app: Hono<AppEnv>): void {
	const router = new Hono<AppEnv>();
	router.get('/app', setAuthLevel(AuthConfig.authenticated), adaptController(OrgController, OrgController.currentApp));
	router.get('/question', setAuthLevel(AuthConfig.authenticated), adaptController(OrgController, OrgController.question));
	app.route('/api/org', router);
}
`;
}

export function orgPopupSource() {
  return `import type { ClarifyingQuestion } from '../utils/message-helpers';

export type QuestionAnswer = {
	question: string;
	selected: string[];
	custom: string;
};

interface ClarifyingQuestionsPopupProps {
	questions: ClarifyingQuestion[];
	open: boolean;
	onSubmit: (answers: QuestionAnswer[]) => void;
	onDismiss?: () => void;
}

export function ClarifyingQuestionsPopup({ questions, open }: ClarifyingQuestionsPopupProps) {
	const question = questions[0];
	if (!open || !question?.question) return null;
	return (
		<div className="rounded-t-xl border border-b-0 bg-bg-4 px-4 py-3">
			<p className="text-xs text-text-tertiary">Question</p>
			<p data-testid="org-question" className="text-sm text-text-primary">{question.question}</p>
			<p className="mt-1 text-xs text-text-tertiary">Reply in the prompt box.</p>
		</div>
	);
}
`;
}

export async function applyOrganizationRun(checkout) {
  await mkdir(join(checkout, "worker/services/org"), { recursive: true });
  await mkdir(join(checkout, "worker/api/controllers/org"), {
    recursive: true,
  });
  await writeFile(join(checkout, "worker/services/org/run.ts"), orgRunSource());
  await writeFile(
    join(checkout, "worker/api/controllers/org/controller.ts"),
    orgControllerSource(),
  );
  await writeFile(
    join(checkout, "worker/api/routes/orgRoutes.ts"),
    orgRoutesSource(),
  );
  await writeFile(
    join(checkout, "src/routes/chat/components/clarifying-questions-popup.tsx"),
    orgPopupSource(),
  );
  const patches = [
    ["worker/api/routes/index.ts", patchRouteIndex],
    ["worker/agents/think/ask-questions-tool.ts", patchAskQuestionsTool],
    ["worker/agents/core/behaviors/think.ts", patchThink],
    ["worker/api/controllers/agent/controller.ts", patchAgentController],
    ["worker/agents/core/codingAgent.ts", patchCodingAgent],
    ["worker/agents/core/websocket.ts", patchWebsocket],
    ["worker/database/services/AppService.ts", patchAppService],
    ["worker/api/controllers/appView/controller.ts", patchAppView],
    ["worker/api/controllers/apps/controller.ts", patchAppsController],
    ["src/components/layout/app-sidebar.tsx", patchSidebar],
    ["src/hooks/use-apps.ts", patchAppsHook],
    ["src/routes/home.tsx", patchHome],
    ["src/routes/chat/chat.tsx", patchChat],
  ];
  for (const [relative, patch] of patches) {
    const path = join(checkout, relative);
    await writeFile(path, patch(await readFile(path, "utf8")));
  }
}
