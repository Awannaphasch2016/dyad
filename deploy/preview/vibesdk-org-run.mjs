// Organization run for the Vibe SDK preview.
// The prompt box already on the page is the only place anyone types.
// The named role sees the question as an Orange message.
// Waiting is one human interaction in the transcript, and that interaction becomes the answer.
// Memberships are read from wewebplus. The shared apps and questions tables
// are not altered: Electron, hitl-web, and Bolt still use their phase columns.
// This run's app, question, and answer rows live on the Vibe SDK app database.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { methodologyModuleSource } from "./methodology-catalog.mjs";

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

export function turnLabel(name) {
  return String(name ?? "").trim();
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
      `${importAnchor}\nimport { publishOrganizationQuestion } from '../../../services/org/run';
import { advanceMethodology, methodologyStepPrompt } from '../../../services/org/methodology';`,
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
      `			const asked = this.organizationHold;
			if (accumulated.text && !asked) {
				this.broadcast(WebSocketMessageResponses.CONVERSATION_RESPONSE, {
					message: accumulated.text,
					conversationId,
					isStreaming: false,
				});
			}
			this.organizationHold = false;
			if (!asked) await advanceMethodology(this.env, this.getAgentId(), 'turn');`,
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
    )
    .replace(
      "systemPrompt: this.buildSystemPrompt(modelName, aiModelConfig.provider),",
      "systemPrompt: this.buildSystemPrompt(modelName, aiModelConfig.provider) + await methodologyStepPrompt(this.env, this.getAgentId()),",
    )
    .replace(
      "await stub.chat(text, forwarder);",
      "await this.configureThinkAgent();\n\t\t\tawait stub.chat(text, forwarder);",
    );
}

export function patchThinkAgent(source) {
  const importAnchor = "import { createSetTitleTool } from './set-title-tool';";
  const writeAnchor = "write: createWriteTool({ ops }),";
  const editAnchor = "edit: createEditTool({ ops }),";
  const deployAnchor = "deploy_space: createDeploySpaceTool({ getStub: () => this.getSpaceStub() }),";
  requireAnchor(source, importAnchor, "think agent import");
  requireAnchor(source, writeAnchor, "think write");
  requireAnchor(source, editAnchor, "think edit");
  requireAnchor(source, deployAnchor, "think deploy");
  return source
    .replace(
      importAnchor,
      `${importAnchor}\nimport { methodologyToolDecision } from '../../services/org/methodology';`,
    )
    .replace(
      writeAnchor,
      "write: this.guardMethodologyTool('write', createWriteTool({ ops })),"
    )
    .replace(
      editAnchor,
      "edit: this.guardMethodologyTool('edit', createEditTool({ ops })),"
    )
    .replace(
      `${deployAnchor}`,
      "deploy_space: this.guardMethodologyTool('deploy_space', createDeploySpaceTool({ getStub: () => this.getSpaceStub() })),"
    )
    .replace(
      "override getTools(): ToolSet {",
      `private guardMethodologyTool(name: string, created: { execute?: (...args: unknown[]) => Promise<unknown> }) {
		const execute = created.execute?.bind(created);
		return {
			...created,
			execute: async (input: unknown, ...rest: unknown[]) => {
				const decision = await methodologyToolDecision(this.env, this.name, name, input);
				if (!decision.allow) return decision.message;
				return execute?.(input, ...rest);
			},
		};
	}

	override getTools(): ToolSet {`,
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
  const oweAnchor = `        await this.saveToDatabase();
        
        return this.state;`;
  requireAnchor(source, importAnchor, "coding import");
  requireAnchor(source, connectAnchor, "coding connect");
  requireAnchor(source, saveAnchor, "coding save");
  requireAnchor(source, oweAnchor, "coding owe");
  return source
    .replace(
      importAnchor,
      `${importAnchor}\nimport { claimOrganizationApp, rememberOrganizationRole } from "../../services/org/run";
import { assertRunnableMethodology } from "../../services/org/methodology";`,
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
    )
    .replace(
      oweAnchor,
      `        await assertRunnableMethodology(this.env);
        await this.saveToDatabase();

        this.setState({
            ...this.state,
            shouldBeGenerating: true,
        });

        return this.state;`,
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
                if (turn.turn) {
                    const speaker = turn.turn.name.trim();
                    broadcastToConnections(agent, WebSocketMessageResponses.CONVERSATION_RESPONSE, {
                        message: (parsedMessage.message ?? '').trim(),
                        conversationId: \`org-answer-\${turn.turn.id}\`,
                        isStreaming: false,
                        speaker,
                    });
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
    `${createAnchor}\t\tconst sharedRoleName = sessionStorage.getItem('vibesdk-shared-role-name') ?? '';\n\t\tif (sharedRoleName === 'Developer') return;\n`,
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
  source = source.replace(
    "import { UserMessage, AIMessage } from './components/messages';",
    "import { UserMessage, AIMessage } from './components/messages';\nimport { AIAvatar } from '../../components/icons/logos';",
  );
  const start = source.indexOf(disabledAnchor);
  const end = source.indexOf(disabledEnd, start);
  const replaced = `${source.slice(0, start)}\tconst [orgBody, setOrgBody] = useState('');
\tconst [orgWaiting, setOrgWaiting] = useState('');
\tconst [orgPending, setOrgPending] = useState<{ id: string; name: string; role: string } | null>(null);
\tconst [orgSeenQuestion, setOrgSeenQuestion] = useState('');
\tconst [orgTurns, setOrgTurns] = useState<Array<{ id: string; body: string; name: string; role: string }>>([]);
\tuseEffect(() => {
\t\tsetOrgBody('');
\t\tsetOrgWaiting('');
\t\tsetOrgPending(null);
\t\tsetOrgSeenQuestion('');
\t\tsetOrgTurns([]);
\t\tsetNewMessage('');
\t\tif (!urlChatId) return;
\t\tlet stop = false;
\t\tconst look = async () => {
\t\t\tconst response = await fetch(\`/api/org/question?appId=\${encodeURIComponent(urlChatId)}\`, { credentials: 'include' });
\t\t\tif (!response.ok) return;
\t\t\tconst payload = await response.json();
\t\t\tif (stop) return;
\t\t\tsetOrgBody(typeof payload?.data?.body === 'string' ? payload.data.body : '');
\t\t\tif (typeof payload?.data?.body === 'string' && payload.data.body) setOrgSeenQuestion(payload.data.body);
\t\t\tsetOrgWaiting(typeof payload?.data?.waiting === 'string' ? payload.data.waiting : '');
\t\t\tconst rawTurns = Array.isArray(payload?.data?.turns) ? payload.data.turns : [];
\t\t\tconst nextTurns: Array<{ id: string; body: string; name: string; role: string }> = [];
\t\t\tfor (const turn of rawTurns) {
\t\t\t\tif (!turn || typeof turn !== 'object') continue;
\t\t\t\tconst record = turn as { id?: unknown; body?: unknown; name?: unknown; role?: unknown };
\t\t\t\tif (typeof record.id !== 'string' || typeof record.body !== 'string' || typeof record.name !== 'string' || typeof record.role !== 'string') continue;
\t\t\t\tnextTurns.push({ id: record.id, body: record.body, name: record.name, role: record.role });
\t\t\t}
\t\t\tsetOrgTurns(nextTurns);
\t\t\tconst rawPending = payload?.data?.pending;
\t\t\tif (rawPending && typeof rawPending === 'object') {
\t\t\t\tconst pending = rawPending as { id?: unknown; name?: unknown; role?: unknown };
\t\t\t\tif (typeof pending.id === 'string' && typeof pending.name === 'string' && typeof pending.role === 'string' && pending.name.trim()) {
\t\t\t\t\tsetOrgPending({ id: pending.id, name: pending.name.trim(), role: pending.role });
\t\t\t\t} else {
\t\t\t\t\tsetOrgPending(null);
\t\t\t\t}
\t\t\t} else {
\t\t\t\tsetOrgPending(null);
\t\t\t}
\t\t};
\t\tvoid look();
\t\tconst timer = window.setInterval(() => void look(), 2000);
\t\treturn () => {
\t\t\tstop = true;
\t\t\twindow.clearInterval(timer);
\t\t};
\t}, [urlChatId]);
\tconst launchTurn = orgTurns.find((turn) => turn.id === 'launch');
\tconst orgLaunchSpeaker = launchTurn
\t\t? launchTurn.name.trim()
\t\t: (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('vibesdk-shared-role') ? ' ' : undefined);
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
  const launchAnchor = `\t\t\t\t\t\t\t\t{!appLoading && (
\t\t\t\t\t\t\t\t\t<UserMessage
\t\t\t\t\t\t\t\t\t\tmessage={query ?? displayQuery}
\t\t\t\t\t\t\t\t\t/>
\t\t\t\t\t\t\t\t)}`;
  const transcriptAnchor =
    "\t\t\t\t\t\t\t\t{otherMessages\n\t\t\t\t\t\t\t\t\t.filter(\n\t\t\t\t\t\t\t\t\t\t(message) => !message.ui?.isThinking,\n\t\t\t\t\t\t\t\t\t)\n\t\t\t\t\t\t\t\t\t.map((message) => {\n\t\t\t\t\t\t\t\t\t\tif (message.role === 'assistant') {\n\t\t\t\t\t\t\t\t\t\t\treturn (\n\t\t\t\t\t\t\t\t\t\t\t\t<AIMessage\n\t\t\t\t\t\t\t\t\t\t\t\t\tkey={message.conversationId}\n\t\t\t\t\t\t\t\t\t\t\t\t\tmessage={message.content}\n\t\t\t\t\t\t\t\t\t\t\t\t\tparts={message.parts}\n\t\t\t\t\t\t\t\t\t\t\t\t\tisThinking={\n\t\t\t\t\t\t\t\t\t\t\t\t\t\tmessage.ui?.isThinking\n\t\t\t\t\t\t\t\t\t\t\t\t\t}\n\t\t\t\t\t\t\t\t\t\t\t\t\ttoolEvents={\n\t\t\t\t\t\t\t\t\t\t\t\t\t\tmessage.ui?.toolEvents\n\t\t\t\t\t\t\t\t\t\t\t\t\t}\n\t\t\t\t\t\t\t\t\t\t\t\t\trichToolPreview={\n\t\t\t\t\t\t\t\t\t\t\t\t\t\trichToolPreview\n\t\t\t\t\t\t\t\t\t\t\t\t\t}\n\t\t\t\t\t\t\t\t\t\t\t\t/>\n\t\t\t\t\t\t\t\t\t\t\t);\n\t\t\t\t\t\t\t\t\t\t}\n\t\t\t\t\t\t\t\t\t\treturn (\n\t\t\t\t\t\t\t\t\t\t\t<UserMessage\n\t\t\t\t\t\t\t\t\t\t\t\tkey={message.conversationId}\n\t\t\t\t\t\t\t\t\t\t\t\tmessage={message.content}\n\t\t\t\t\t\t\t\t\t\t\t/>\n\t\t\t\t\t\t\t\t\t\t);\n\t\t\t\t\t\t\t\t\t})}";
  const sendAnchor = "\t\t\tsendUserMessage(newMessage);";
  requireAnchor(replaced, badgeAnchor, "chat gallery chip");
  requireAnchor(replaced, ownerAnchor, "chat owner");
  requireAnchor(replaced, launchAnchor, "chat launch turn");
  requireAnchor(replaced, transcriptAnchor, "chat transcript");
  requireAnchor(replaced, sendAnchor, "chat send");
  return replaced
    .replace(ownerAnchor, "\tconst isOwner = false;")
    .replace(badgeAnchor, "")
    .replace(
      popupAnchor,
      `\t\t\t\t\t\t\taboveContent={
\t\t\t\t\t\t\t\t<ClarifyingQuestionsPopup
\t\t\t\t\t\t\t\t\tquestions={orgBody ? [{ question: orgBody }] : []}
\t\t\t\t\t\t\t\t\topen={Boolean(orgBody || orgWaiting)}
\t\t\t\t\t\t\t\t\twaiting={orgWaiting}
\t\t\t\t\t\t\t\t\tonSubmit={submitClarifyingAnswers}
\t\t\t\t\t\t\t\t\tonDismiss={dismissClarifyingQuestions}
\t\t\t\t\t\t\t\t/>
\t\t\t\t\t\t\t}`,
    )
    .replace(
      launchAnchor,
      `\t\t\t\t\t\t\t\t{!appLoading && (
\t\t\t\t\t\t\t\t\t<UserMessage
\t\t\t\t\t\t\t\t\t\tmessage={query ?? displayQuery}
\t\t\t\t\t\t\t\t\t\tspeaker={orgLaunchSpeaker}
\t\t\t\t\t\t\t\t\t\trole={launchTurn?.role}
\t\t\t\t\t\t\t\t\t/>
\t\t\t\t\t\t\t\t)}`,
    )
    .replace(
      transcriptAnchor,
      '{(() => {\n\t\t\t\t\t\t\t\tconst orgAnswer = (message: { conversationId?: string; role?: string; content?: string }) =>\n\t\t\t\t\t\t\t\t\tBoolean(message.conversationId?.startsWith(\'org-answer-\')) ||\n\t\t\t\t\t\t\t\t\t(message.role === \'user\' && orgTurns.some((turn) => turn.id !== \'launch\' && turn.body === message.content));\n\t\t\t\t\t\t\t\tconst visible = otherMessages.filter((message) => !message.ui?.isThinking && !orgAnswer(message));\n\t\t\t\t\t\t\t\tconst completed = orgTurns.filter((turn) => turn.id !== \'launch\');\n\t\t\t\t\t\t\t\tconst latestId = orgPending ? \'\' : (completed[completed.length - 1]?.id ?? \'\');\n\t\t\t\t\t\t\t\tconst earlier = completed.filter((turn) => turn.id !== latestId);\n\t\t\t\t\t\t\t\tconst current = latestId ? completed.find((turn) => turn.id === latestId) : undefined;\n\t\t\t\t\t\t\t\tconst answerIndex = otherMessages.findIndex((message) => !message.ui?.isThinking && orgAnswer(message));\n\t\t\t\t\t\t\t\tconst afterIds = new Set<string>();\n\t\t\t\t\t\t\t\tif (answerIndex >= 0) {\n\t\t\t\t\t\t\t\t\tfor (const message of otherMessages.slice(answerIndex + 1)) {\n\t\t\t\t\t\t\t\t\t\tif (message.ui?.isThinking || orgAnswer(message)) continue;\n\t\t\t\t\t\t\t\t\t\tif (message.conversationId) afterIds.add(message.conversationId);\n\t\t\t\t\t\t\t\t\t}\n\t\t\t\t\t\t\t\t}\n\t\t\t\t\t\t\t\tconst before = visible.filter((message) => !message.conversationId || !afterIds.has(message.conversationId));\n\t\t\t\t\t\t\t\tconst after = visible.filter((message) => Boolean(message.conversationId && afterIds.has(message.conversationId)));\n\t\t\t\t\t\t\t\tconst renderMessage = (message: (typeof otherMessages)[number]) => {\n\t\t\t\t\t\t\t\t\tif (message.role === \'assistant\') {\n\t\t\t\t\t\t\t\t\t\treturn (\n\t\t\t\t\t\t\t\t\t\t\t<AIMessage\n\t\t\t\t\t\t\t\t\t\t\t\tkey={message.conversationId}\n\t\t\t\t\t\t\t\t\t\t\t\tmessage={message.content}\n\t\t\t\t\t\t\t\t\t\t\t\tparts={message.parts}\n\t\t\t\t\t\t\t\t\t\t\t\tisThinking={message.ui?.isThinking}\n\t\t\t\t\t\t\t\t\t\t\t\ttoolEvents={message.ui?.toolEvents}\n\t\t\t\t\t\t\t\t\t\t\t\trichToolPreview={richToolPreview}\n\t\t\t\t\t\t\t\t\t\t\t/>\n\t\t\t\t\t\t\t\t\t\t);\n\t\t\t\t\t\t\t\t\t}\n\t\t\t\t\t\t\t\t\treturn (\n\t\t\t\t\t\t\t\t\t\t<UserMessage\n\t\t\t\t\t\t\t\t\t\t\tkey={message.conversationId}\n\t\t\t\t\t\t\t\t\t\t\tmessage={message.content}\n\t\t\t\t\t\t\t\t\t\t\tspeaker={message.speaker}\n\t\t\t\t\t\t\t\t\t\t/>\n\t\t\t\t\t\t\t\t\t);\n\t\t\t\t\t\t\t\t};\n\t\t\t\t\t\t\t\treturn (\n\t\t\t\t\t\t\t\t\t<>\n\t\t\t\t\t\t\t\t\t\t{before.map(renderMessage)}\n\t\t\t\t\t\t\t\t\t\t{earlier.map((turn) => (\n\t\t\t\t\t\t\t\t\t\t\t<UserMessage\n\t\t\t\t\t\t\t\t\t\t\t\tkey={turn.id}\n\t\t\t\t\t\t\t\t\t\t\t\tmessage={turn.body}\n\t\t\t\t\t\t\t\t\t\t\t\tspeaker={turn.name.trim()}\n\t\t\t\t\t\t\t\t\t\t\t\trole={turn.role}\n\t\t\t\t\t\t\t\t\t\t\t/>\n\t\t\t\t\t\t\t\t\t\t))}\n\t\t\t\t\t\t\t\t\t\t{orgSeenQuestion ? (\n\t\t\t\t\t\t\t\t\t\t\t<div data-testid="org-builder-question" className="flex flex-col gap-2 min-w-0">\n\t\t\t\t\t\t\t\t\t\t\t\t<div className="font-mono font-medium text-text-50 flex items-center gap-2 mb-3">\n\t\t\t\t\t\t\t\t\t\t\t\t\t<AIAvatar className="size-5 text-orange-500 shrink-0" />\n\t\t\t\t\t\t\t\t\t\t\t\t\tOrange\n\t\t\t\t\t\t\t\t\t\t\t\t</div>\n\t\t\t\t\t\t\t\t\t\t\t\t<p data-testid="org-question" className="text-text-primary/80">{orgSeenQuestion}</p>\n\t\t\t\t\t\t\t\t\t\t\t\t{orgBody ? <p className="mt-1 text-xs text-text-tertiary">Reply in the prompt box.</p> : null}\n\t\t\t\t\t\t\t\t\t\t\t</div>\n\t\t\t\t\t\t\t\t\t\t) : null}\n\t\t\t\t\t\t\t\t\t\t{orgPending ? (\n\t\t\t\t\t\t\t\t\t\t\t<UserMessage\n\t\t\t\t\t\t\t\t\t\t\t\tkey={orgPending.id}\n\t\t\t\t\t\t\t\t\t\t\t\tmessage=""\n\t\t\t\t\t\t\t\t\t\t\t\tspeaker={orgPending.name.trim()}\n\t\t\t\t\t\t\t\t\t\t\t\trole={orgPending.role}\n\t\t\t\t\t\t\t\t\t\t\t\tpending\n\t\t\t\t\t\t\t\t\t\t\t/>\n\t\t\t\t\t\t\t\t\t\t) : null}\n\t\t\t\t\t\t\t\t\t\t{current ? (\n\t\t\t\t\t\t\t\t\t\t\t<UserMessage\n\t\t\t\t\t\t\t\t\t\t\t\tkey={current.id}\n\t\t\t\t\t\t\t\t\t\t\t\tmessage={current.body}\n\t\t\t\t\t\t\t\t\t\t\t\tspeaker={current.name.trim()}\n\t\t\t\t\t\t\t\t\t\t\t\trole={current.role}\n\t\t\t\t\t\t\t\t\t\t\t/>\n\t\t\t\t\t\t\t\t\t\t) : null}\n\t\t\t\t\t\t\t\t\t\t{after.map(renderMessage)}\n\t\t\t\t\t\t\t\t\t</>\n\t\t\t\t\t\t\t\t);\n\t\t\t\t\t\t\t})()}',
    )
    .replace(
      sendAnchor,
      "\t\t\tif (!sessionStorage.getItem('vibesdk-shared-role')) sendUserMessage(newMessage);",
    );
}

export function patchSidebar(source) {
  const pathAnchor =
    "\tconst getAppPath = (app: App) =>\n\t\tapp.userId === user?.id ? `/chat/${app.id}` : `/app/${app.id}`;";
  const iconAnchor =
    "\tconst getVisibilityIcon = (visibility: App['visibility']) => {";
  const labelAnchor =
    '\t\t\t\t\t\t\t<span className="text-xs font-funky-mono">\n\t\t\t\t\t\t\t\tApps\n\t\t\t\t\t\t\t</span>';
  requireAnchor(source, pathAnchor, "sidebar path");
  requireAnchor(source, iconAnchor, "sidebar icon");
  requireAnchor(source, labelAnchor, "sidebar apps label");
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
    `\tconst sharedRoleName = sessionStorage.getItem('vibesdk-shared-role-name') ?? '';
	const sharedOrg = sessionStorage.getItem('vibesdk-shared-org') ?? '';
	const getAppPath = (app: App) =>
		sharedRoleName === 'Project Manager' || sharedRoleName === 'Developer' || app.userId === user?.id
			? \`/chat/\${app.id}\`
			: \`/app/\${app.id}\`;`,
  ).replace(
    labelAnchor,
    '\t\t\t\t\t\t\t<span className="text-xs font-funky-mono">\n\t\t\t\t\t\t\t\t{sharedOrg || \'Apps\'}\n\t\t\t\t\t\t\t</span>',
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
import { advanceMethodology, resolveMethodology } from './methodology';

const PM_ROLE = 'project-manager';
const DEV_ROLE = 'developer';

type Actor = { role: string; userId: string; orgId: string };
type GateRow = { org_id?: string; role_id?: string; user_id?: string };
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

const clerkNames = new Map<string, string>();

function roleTitle(role: string): string {
	return role === DEV_ROLE ? 'Developer' : 'Project Manager';
}

function turnLabel(name: string): string {
	return name.trim();
}

async function memberName(env: Env, userId: string): Promise<string> {
	const cached = clerkNames.get(userId);
	if (cached) return cached;
	let name = '';
	const secret = binding(env, 'CLERK_SECRET_KEY');
	if (secret.startsWith('sk_test_') || secret.startsWith('sk_live_')) {
		try {
			const response = await fetch('https://api.clerk.com/v1/users/' + encodeURIComponent(userId), {
				headers: { Authorization: 'Bearer ' + secret },
			});
			if (response.ok) {
				const user = await response.json() as { first_name?: string | null; last_name?: string | null; username?: string | null };
				name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
				if (!name && typeof user.username === 'string') name = user.username.trim();
			}
		} catch {
			name = '';
		}
	}
	if (!name) {
		try {
			const row = await env.DB.prepare('SELECT display_name FROM users WHERE id = ?').bind(userId).first<{ display_name: string | null }>();
			name = row?.display_name?.trim() ?? '';
		} catch {
			name = '';
		}
	}
	if (name) clerkNames.set(userId, name);
	return name;
}

type HumanTurn = { id: string; body: string; name: string; role: string };

async function humanTurns(env: Env, appId: string): Promise<HumanTurn[]> {
	const app = await env.DB.prepare('SELECT created_by, original_prompt, title FROM apps WHERE id = ?').bind(appId).first<{ created_by: string | null; original_prompt: string | null; title: string | null }>();
	const turns: HumanTurn[] = [];
	if (app?.created_by) {
		const body = (app.original_prompt || app.title || '').trim();
		const member = await membership(env, app.created_by);
		if (member && body) {
			turns.push({ id: 'launch', body, name: await memberName(env, app.created_by), role: roleTitle(member.role) });
		}
	}
	const answers = await env.DB.prepare('SELECT answers.question_id, answers.user_id, answers.body FROM answers INNER JOIN questions ON questions.id = answers.question_id WHERE questions.app_id = ? ORDER BY answers.created_at ASC').bind(appId).all<{ question_id: string; user_id: string; body: string }>();
	for (const row of answers.results ?? []) {
		const body = row.body?.trim() ?? '';
		const member = await membership(env, row.user_id);
		if (!member || !body) continue;
		turns.push({ id: row.question_id, body, name: await memberName(env, row.user_id), role: roleTitle(member.role) });
	}
	return turns;
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
		'ALTER TABLE apps ADD COLUMN methodology TEXT',
		'ALTER TABLE apps ADD COLUMN methodology_step TEXT',
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
	const resolved = resolveMethodology((env as { VIBESDK_METHODOLOGY?: string }).VIBESDK_METHODOLOGY);
	if (!resolved.ok) throw new Error(resolved.message);
	await env.DB.prepare('UPDATE apps SET org_id = ?, created_by = ?, methodology = ?, methodology_step = ? WHERE id = ?').bind(member.orgId, userId, resolved.record.id, resolved.record.steps[0].id, appId).run();
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

async function roleMemberId(env: Env, orgId: string, role: string): Promise<string> {
	const databaseUrl = binding(env, 'WEWEBPLUS_DATABASE_URL');
	if (!databaseUrl || !orgId || !role) return '';
	const rows = await neonQuery(
		databaseUrl,
		'select user_id from wewebplus.memberships where org_id = $1 and role_id = $2',
		[orgId, role],
	);
	const ids = rows.map((row) => row.user_id ?? '').filter((id) => id);
	return ids.length === 1 ? ids[0] : '';
}

async function pendingInteraction(env: Env, orgId: string, questionId: string, targetRole: string, turns: HumanTurn[]): Promise<{ id: string; name: string; role: string } | null> {
	const userId = await roleMemberId(env, orgId, targetRole);
	const lookedUp = userId ? (await memberName(env, userId)).trim() : '';
	const launch = targetRole === PM_ROLE ? turns.find((turn) => turn.id === 'launch') : undefined;
	const name = lookedUp || launch?.name.trim() || '';
	if (!name) return null;
	return { id: questionId, name, role: roleTitle(targetRole) };
}

export async function openOrganizationQuestion(env: Env, userId: string, appId: string): Promise<{ body: string | null; waiting: string | null; turns: HumanTurn[]; pending: { id: string; name: string; role: string } | null } | null> {
	await ensureOrganizationSchema(env);
	const member = await membership(env, userId);
	if (!member || !appId) return null;
	const app = await env.DB.prepare('SELECT org_id FROM apps WHERE id = ?').bind(appId).first<{ org_id: string | null }>();
	if (!app?.org_id || app.org_id !== member.orgId) return null;
	const turns = await humanTurns(env, appId);
	const open = await env.DB.prepare("SELECT id, target_role_id, body, status FROM questions WHERE app_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1").bind(appId).first<{ id: string; target_role_id: string; body: string; status: string }>();
	if (!open) return { body: null, waiting: null, turns, pending: null };
	const pending = await pendingInteraction(env, member.orgId, open.id, open.target_role_id, turns);
	if (open.target_role_id === member.role) return { body: open.body, waiting: null, turns, pending };
	return { body: null, waiting: waitingLine(open.target_role_id), turns, pending };
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

export async function acceptOrganizationAnswer(env: Env, appId: string, connection: WebSocket, message: string): Promise<{ allow: boolean; message: string; turn?: { id: string; body: string; name: string; role: string; label: string } }> {
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
	await advanceMethodology(env, appId, 'answer');
	const name = await memberName(env, actor.userId);
	const role = roleTitle(actor.role);
	return { allow: true, message: '', turn: { id: open.id, body: text, name, role, label: turnLabel(name) } };
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

export function ClarifyingQuestionsPopup(props: ClarifyingQuestionsPopupProps & { waiting?: string }) {
	void props;
	return null;
}
`;
}

export function patchSocketType(source) {
  const anchor =
    "\ttype: 'conversation_response';\n\tmessage: string;\n\tconversationId?: string;\n";
  requireAnchor(source, anchor, "socket turn type");
  return source.replace(anchor, `${anchor}\tspeaker?: string;\n`);
}

export function patchChatMessage(source) {
  const anchor = "    queuePosition?: number;\n};";
  requireAnchor(source, anchor, "chat message speaker");
  return source.replace(
    anchor,
    "    queuePosition?: number;\n    speaker?: string;\n};",
  );
}

export function patchUserMessage(source) {
  const anchor =
    'export function UserMessage({ message }: { message: string }) {\n\tconst sanitizedMessage = sanitizeMessageForDisplay(message);\n\n\treturn (\n\t\t<div className="flex flex-col gap-2 min-w-0">\n\t\t\t<div className="flex items-center gap-2 mb-3">\n\t\t\t\t<div className="size-5 flex items-center justify-center rounded-full bg-brand text-white shrink-0">\n\t\t\t\t\t<span className="text-[10px]">U</span>\n\t\t\t\t</div>\n\t\t\t\t<div className="font-medium text-text-50">You</div>\n\t\t\t</div>\n\t\t\t<Markdown className="text-text-primary/80">{sanitizedMessage}</Markdown>\n\t\t</div>\n\t);\n}';
  const waitingAnchor =
    "\tconst sanitizedMessage = sanitizeMessageForDisplay(message);\n\n\t// Ordered parts are authoritative; fall back to a single text part for the\n\t// few literal placeholder messages that are constructed without parts.\n\tconst resolvedParts: MessagePart[] = parts && parts.length > 0\n\t\t? parts\n\t\t: (sanitizedMessage ? [{ type: 'text', text: sanitizedMessage }] : []);";
  const helperAnchor =
    "\treturn message.replace(/<system_context>[\\s\\S]*?<\\/system_context>\\n/gi, '').trim();\n}";
  requireAnchor(source, anchor, "user message label");
  requireAnchor(source, waitingAnchor, "assistant waiting text");
  requireAnchor(source, helperAnchor, "assistant text helper");
  return source
    .replace(
      anchor,
      'export function UserMessage({ message, speaker, role, pending }: { message: string; speaker?: string; role?: string; pending?: boolean }) {\n\tconst sanitizedMessage = sanitizeMessageForDisplay(message);\n\tconst label = speaker?.trim() ? speaker.trim() : \'You\';\n\tconst kind = role === \'Developer\' ? \'dev\' : role === \'Project Manager\' ? \'pm\' : \'\';\n\n\treturn (\n\t\t<div\n\t\t\tclassName={pending ? \'flex flex-col gap-2 min-w-0 rounded-lg border border-orange-500 bg-bg-4 px-3 py-2\' : \'flex flex-col gap-2 min-w-0\'}\n\t\t\tdata-testid={pending ? \'org-pending\' : speaker?.trim() ? \'org-human-turn\' : undefined}\n\t\t>\n\t\t\t<div className="flex items-center gap-2 mb-3">\n\t\t\t\t{kind === \'pm\' ? (\n\t\t\t\t\t<svg data-testid="org-avatar-pm" aria-label="Project Manager" viewBox="0 0 28 28" className="size-5 shrink-0">\n\t\t\t\t\t\t<circle cx="14" cy="14" r="14" fill="#f6821f" />\n\t\t\t\t\t\t<path fill="white" d="M14 7.2a3.1 3.1 0 1 1 0 6.2 3.1 3.1 0 0 1 0-6.2zm-5.2 11.2c.6-2.4 2.6-3.8 5.2-3.8s4.6 1.4 5.2 3.8c.2.7-.3 1.4-1 1.4H9.8c-.7 0-1.2-.7-1-1.4z" />\n\t\t\t\t\t</svg>\n\t\t\t\t) : kind === \'dev\' ? (\n\t\t\t\t\t<svg data-testid="org-avatar-dev" aria-label="Developer" viewBox="0 0 28 28" className="size-5 shrink-0">\n\t\t\t\t\t\t<circle cx="14" cy="14" r="14" fill="#1d4ed8" />\n\t\t\t\t\t\t<path fill="white" d="M8 18.5 12.2 9h1.6l4.2 9.5h-1.7l-.8-2H10.5l-.8 2H8zm3.2-3.4h3.6L14 11.2l-2.8 3.9z" />\n\t\t\t\t\t</svg>\n\t\t\t\t) : (\n\t\t\t\t\t<div className="size-5 flex items-center justify-center rounded-full bg-brand text-white shrink-0">\n\t\t\t\t\t\t<span className="text-[10px]">{label === \'You\' ? \'U\' : label.slice(0, 1).toUpperCase()}</span>\n\t\t\t\t\t</div>\n\t\t\t\t)}\n\t\t\t\t<div className="font-medium text-text-50" data-testid={speaker?.trim() ? \'org-turn\' : undefined}>{label}</div>\n\t\t\t\t{pending ? (\n\t\t\t\t\t<div data-testid="org-response-required" className="text-xs font-semibold text-orange-500">Response required</div>\n\t\t\t\t) : null}\n\t\t\t</div>\n\t\t\t{pending ? (\n\t\t\t\t<p className="text-sm text-text-tertiary">This account answers in the prompt box.</p>\n\t\t\t) : (\n\t\t\t\t<Markdown className="text-text-primary/80">{sanitizedMessage}</Markdown>\n\t\t\t)}\n\t\t</div>\n\t);\n}',
    )
    .replace(
      waitingAnchor,
      "\tconst sanitizedMessage = orgVisibleText(sanitizeMessageForDisplay(message));\n\n\t// Ordered parts are authoritative; fall back to a single text part for the\n\t// few literal placeholder messages that are constructed without parts.\n\tconst resolvedParts: MessagePart[] = (parts && parts.length > 0\n\t\t? parts\n\t\t: (sanitizedMessage ? [{ type: 'text', text: sanitizedMessage }] : [])\n\t).flatMap((part): MessagePart[] => {\n\t\tif (part.type !== 'text') return [part];\n\t\tconst text = orgVisibleText(part.text);\n\t\treturn text ? [{ ...part, text }] : [];\n\t});",
    )
    .replace(
      helperAnchor,
      "\treturn message.replace(/<system_context>[\\s\\S]*?<\\/system_context>\\n/gi, '').trim();\n}\n\nfunction orgVisibleText(message: string): string {\n\treturn message\n\t\t.replaceAll('Waiting on the Project Manager.', '')\n\t\t.replaceAll('Waiting on the Developer.', '')\n\t\t.trim();\n}",
    );
}

export function patchConversationHandler(source) {
  const importAnchor = "    createAIMessage,\n";
  const caseAnchor =
    "            case 'conversation_response': {\n                // Use concrete conversationId when available; otherwise use placeholder id\n                let conversationId = message.conversationId ?? 'conversation_response';\n";
  const resumeAnchor = `                    setIsInitialStateRestored(true);
                    
                    if (state.shouldBeGenerating && !isGenerating) {
                        logger.debug('🔄 Reconnected with shouldBeGenerating=true, auto-resuming generation');
                        setIsGenerating(true); 
                        updateStage('code', { status: 'active' });
                        sendWebSocketMessage(websocket, 'generate_all');
                    }
                }
                break;`;
  requireAnchor(source, importAnchor, "conversation import");
  requireAnchor(source, caseAnchor, "conversation response");
  requireAnchor(source, resumeAnchor, "conversation resume");
  return source
    .replace(importAnchor, "    createAIMessage,\n    createUserMessage,\n")
    .replace(
      resumeAnchor,
      `                    setIsInitialStateRestored(true);
                }
                if (state.shouldBeGenerating && !isGenerating) {
                    logger.debug('🔄 Reconnected with shouldBeGenerating=true, auto-resuming generation');
                    setIsGenerating(true);
                    updateStage('code', { status: 'active' });
                    sendWebSocketMessage(websocket, 'generate_all');
                }
                break;`,
    )
    .replace(
      caseAnchor,
      `${caseAnchor}                if (message.speaker && message.conversationId?.startsWith('org-answer-')) {
                    const speaker = message.speaker;
                    const text = message.message;
                    const answerId = message.conversationId;
                    setMessages(prev => {
                        if (prev.some(item => item.conversationId === answerId)) return prev;
                        const unlabeled = prev.findIndex(item => item.role === 'user' && item.content === text && !item.speaker);
                        const labeled = { ...createUserMessage(text), conversationId: answerId, speaker };
                        if (unlabeled >= 0) return prev.map((item, index) => index === unlabeled ? labeled : item);
                        return [...prev, labeled];
                    });
                    break;
                }

`,
    );
}

export function patchUseChat(source) {
  const anchor =
    "\t\t\t\t\t// Request file generation for new chats only\n\t\t\t\t\tif (!disableGenerate && urlChatId === 'new') {\n\t\t\t\t\t\tlogger.debug('🔄 Starting code generation for new chat');\n\t\t\t\t\t\tsetIsGenerating(true);\n\t\t\t\t\t\tsendWebSocketMessage(ws, 'generate_all');\n\t\t\t\t\t}\n";
  requireAnchor(source, anchor, "chat open generate");
  return source.replace(anchor, "");
}

export async function applyOrganizationRun(checkout) {
  await mkdir(join(checkout, "worker/services/org"), { recursive: true });
  await mkdir(join(checkout, "worker/api/controllers/org"), {
    recursive: true,
  });
  await writeFile(join(checkout, "worker/services/org/methodology.ts"), methodologyModuleSource());
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
    ["worker/agents/think/ThinkAgent.ts", patchThinkAgent],
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
    ["src/routes/chat/components/messages.tsx", patchUserMessage],
    ["src/routes/chat/utils/message-helpers.ts", patchChatMessage],
    [
      "src/routes/chat/utils/handle-websocket-message.ts",
      patchConversationHandler,
    ],
    ["src/routes/chat/hooks/use-chat.ts", patchUseChat],
    ["worker/api/websocketTypes.ts", patchSocketType],
  ];
  for (const [relative, patch] of patches) {
    const path = join(checkout, relative);
    await writeFile(path, patch(await readFile(path, "utf8")));
  }
}
