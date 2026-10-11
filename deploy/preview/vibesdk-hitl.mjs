// Role-routed questions for the Vibe SDK preview. The Think model is not
// asked to invent the first proof: a scripted run asks the Project Manager,
// then the Developer, then stops.

export const SCRIPTED_APP_ID = "scripted-hitl";
export const SCRIPTED_TITLE = "Shared organization app";
export const PM_QUESTION = "What should the page be called?";
export const DEV_QUESTION = "Which file should hold the page title?";
export const WAITING_PM = "Waiting on the Project Manager.";
export const WAITING_DEV = "Waiting on the Developer.";
export const CONTINUED = "The agent continued.";
export const COMPLETE = "The app is complete.";
export const PM_ROLE = "project-manager";
export const DEV_ROLE = "developer";

const ROLES = new Set([PM_ROLE, DEV_ROLE]);

export function assignRole(role) {
  if (ROLES.has(role)) return { targetRole: role, assignment: "declared" };
  return { targetRole: PM_ROLE, assignment: "fallback" };
}

export function roleLabel(role) {
  return role === DEV_ROLE ? "Developer" : "Project Manager";
}

export function waitingLine(role) {
  return role === DEV_ROLE ? WAITING_DEV : WAITING_PM;
}

export function presentQuestion(question, role) {
  if (!question || question.status !== "open") return null;
  if (question.targetRole === role) {
    return { body: question.body, canAnswer: true, waiting: null };
  }
  return { body: null, canAnswer: false, waiting: waitingLine(question.targetRole) };
}

export function decideAnswer(question, role) {
  if (!question) return "not-found";
  if (question.status !== "open") return "closed";
  if (question.targetRole !== role) return "forbidden";
  return "allow";
}

export function resumePrompt(question, answer) {
  return `Question: ${question.body}\nAnswer: ${answer}`;
}

export function reduceAnswer(question, role, answer) {
  const decision = decideAnswer(question, role);
  if (decision !== "allow") return { decision };
  const text = String(answer ?? "").trim();
  if (!text) return { decision: "empty" };
  const prompt = resumePrompt(question, text);
  if (question.targetRole === PM_ROLE) {
    const next = assignRole(DEV_ROLE);
    return {
      decision: "allow",
      prompt,
      forRole: PM_ROLE,
      agentStatus: "running",
      shared: CONTINUED,
      next: {
        targetRole: next.targetRole,
        body: DEV_QUESTION,
        assignment: next.assignment,
        keySuffix: ":dev",
      },
    };
  }
  return {
    decision: "allow",
    prompt,
    forRole: DEV_ROLE,
    agentStatus: "completed",
    shared: COMPLETE,
    next: null,
  };
}

export function sharedLines(agentStatus) {
  if (agentStatus === "completed") return [COMPLETE];
  if (agentStatus === "running") return [CONTINUED];
  return [];
}

function requireAnchor(source, anchor, label) {
  if (!source.includes(anchor)) {
    throw new Error(`hitl patch missed ${label}`);
  }
}

export function patchRouteIndex(source) {
  const importAnchor = "import { setupAuthRoutes } from './authRoutes';";
  const callAnchor = "    setupAuthRoutes(app);";
  requireAnchor(source, importAnchor, "route import");
  requireAnchor(source, callAnchor, "route call");
  return source
    .replace(
      importAnchor,
      `${importAnchor}\nimport { setupHitlRoutes } from './hitlRoutes';`,
    )
    .replace(callAnchor, `${callAnchor}\n    setupHitlRoutes(app);`);
}

export function patchHome(source) {
  const importAnchor = "import { PromptBox } from '@/components/prompt-box';";
  const mountAnchor = "\t\t\t\t\t\t</div>\n\t\t\t\t\t\t<PromptBox";
  requireAnchor(source, importAnchor, "home import");
  requireAnchor(source, mountAnchor, "home mount");
  return source
    .replace(
      importAnchor,
      `${importAnchor}\nimport { HitlRun } from '@/components/hitl/hitl-run';`,
    )
    .replace(mountAnchor, "\t\t\t\t\t\t</div>\n\t\t\t\t\t\t<HitlRun />\n\t\t\t\t\t\t<PromptBox");
}

export function hitlRoutesSource() {
  return `import { Hono } from 'hono';
import { AppEnv } from '../../types/appenv';
import { adaptController } from '../honoAdapter';
import { AuthConfig, setAuthLevel } from '../../middleware/auth/routeAuth';
import { HitlController } from '../controllers/hitl/controller';

export function setupHitlRoutes(app: Hono<AppEnv>): void {
    const router = new Hono<AppEnv>();
    router.get('/', setAuthLevel(AuthConfig.authenticated), adaptController(HitlController, HitlController.getState));
    router.post('/script/start', setAuthLevel(AuthConfig.authenticated), adaptController(HitlController, HitlController.start));
    router.post('/questions/:id/answers', setAuthLevel(AuthConfig.authenticated), adaptController(HitlController, HitlController.answer));
    app.route('/api/hitl', router);
}
`;
}

export function hitlPanelSource() {
  return `import { useCallback, useEffect, useState } from 'react';

type OpenQuestion = {
	id: string;
	body: string | null;
	canAnswer: boolean;
	waiting: string | null;
};

type HitlState = {
	role: string;
	roleLabel: string;
	app: { title: string; agentStatus: string } | null;
	open: OpenQuestion | null;
	resumes: { prompt: string }[];
	shared: string[];
};

async function readState(): Promise<HitlState | null> {
	const response = await fetch('/api/hitl', { credentials: 'include' });
	if (!response.ok) return null;
	const payload = await response.json();
	return payload?.data ?? null;
}

async function postJson(path: string, body?: unknown): Promise<Response> {
	const csrf = await fetch('/api/auth/csrf-token', { credentials: 'include' });
	const csrfPayload = csrf.ok ? await csrf.json() : null;
	const token = csrfPayload?.data?.token;
	return fetch(path, {
		method: 'POST',
		credentials: 'include',
		headers: {
			'Content-Type': 'application/json',
			...(typeof token === 'string' ? { 'X-CSRF-Token': token } : {}),
		},
		body: JSON.stringify(body ?? {}),
	});
}

export function HitlRun() {
	const [state, setState] = useState<HitlState | null>(null);
	const [answer, setAnswer] = useState('');
	const [error, setError] = useState('');

	const refresh = useCallback(async () => {
		setState(await readState());
	}, []);

	useEffect(() => {
		void refresh();
		const timer = window.setInterval(() => {
			void refresh();
		}, 2000);
		return () => window.clearInterval(timer);
	}, [refresh]);

	if (!state?.role) return null;
	const open = state.open;

	return (
		<section
			data-testid="hitl-run"
			aria-label="Organization run"
			className="mb-6 rounded-xl border border-kumo-line bg-white/80 p-4 text-left"
		>
			<p className="text-sm text-kumo-subtle">You are the {state.roleLabel}.</p>
			{state.app ? <p className="mt-1 text-sm font-medium">{state.app.title}</p> : null}
			{state.shared.map((line) => (
				<p key={line} className="mt-2 text-sm">
					{line}
				</p>
			))}
			{state.resumes.map((resume) => (
				<pre key={resume.prompt} className="mt-2 whitespace-pre-wrap text-sm">
					{resume.prompt}
				</pre>
			))}
			{open?.canAnswer && open.body ? (
				<form
					className="mt-3 grid gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						void (async () => {
							setError('');
							const response = await postJson(\`/api/hitl/questions/\${open.id}/answers\`, {
								answer,
							});
							if (!response.ok) {
								setError('The answer was not saved.');
								return;
							}
							setAnswer('');
							await refresh();
						})();
					}}
				>
					<p className="text-sm">{open.body}</p>
					<label className="grid gap-1 text-sm">
						Your answer
						<input
							className="rounded-md border border-kumo-line px-2 py-1"
							value={answer}
							onChange={(event) => setAnswer(event.target.value)}
						/>
					</label>
					<button
						type="submit"
						className="w-fit rounded-md bg-brand-emphasis px-3 py-1 text-sm text-white"
					>
						Submit answer
					</button>
				</form>
			) : null}
			{open && !open.canAnswer && open.waiting ? (
				<p className="mt-3 text-sm">{open.waiting}</p>
			) : null}
			{!state.app && state.role === '${PM_ROLE}' ? (
				<button
					type="button"
					className="mt-3 rounded-md bg-brand-emphasis px-3 py-1 text-sm text-white"
					onClick={() => {
						void (async () => {
							setError('');
							const response = await postJson('/api/hitl/script/start');
							if (!response.ok) setError('The run did not start.');
							await refresh();
						})();
					}}
				>
					Start the scripted build
				</button>
			) : null}
			{!state.app && state.role === '${DEV_ROLE}' ? (
				<p className="mt-3 text-sm">Waiting for the Project Manager to start.</p>
			) : null}
			{error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
		</section>
	);
}
`;
}

export function hitlControllerSource() {
  return `import { BaseController } from '../baseController';
import type { RouteContext } from '../../types/route-context';

const APP_ID = ${JSON.stringify(SCRIPTED_APP_ID)};
const APP_TITLE = ${JSON.stringify(SCRIPTED_TITLE)};
const PM_QUESTION = ${JSON.stringify(PM_QUESTION)};
const DEV_QUESTION = ${JSON.stringify(DEV_QUESTION)};
const PM_ROLE = ${JSON.stringify(PM_ROLE)};
const DEV_ROLE = ${JSON.stringify(DEV_ROLE)};
const CONTINUED = ${JSON.stringify(CONTINUED)};
const COMPLETE = ${JSON.stringify(COMPLETE)};

type GateRow = { org_id?: string; role_id?: string };
type QuestionRow = {
	id: string;
	org_id: string;
	app_id: string;
	target_role: string;
	body: string;
	status: string;
	idempotency_key: string;
	assignment: string;
};

let ready: Promise<void> | null = null;

function roleLabel(role: string): string {
	return role === DEV_ROLE ? 'Developer' : 'Project Manager';
}

function waitingLine(role: string): string {
	return role === DEV_ROLE ? 'Waiting on the Developer.' : 'Waiting on the Project Manager.';
}

async function neonQuery(databaseUrl: string, query: string, params: string[]): Promise<GateRow[]> {
	const endpoint = new URL(databaseUrl);
	const host = endpoint.hostname.replace('-pooler.', '.');
	endpoint.hostname = host;
	const response = await fetch(\`https://\${host}/sql\`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Neon-Connection-String': endpoint.toString(),
		},
		body: JSON.stringify({ query, params }),
	});
	if (!response.ok) return [];
	const payload = (await response.json()) as { fields?: { name: string }[]; rows?: unknown[] };
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

function binding(env: Env, name: string): string {
	const value = (env as unknown as Record<string, unknown>)[name];
	return typeof value === 'string' ? value : '';
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

async function ensureSchema(env: Env): Promise<void> {
	if (!ready) {
		ready = (async () => {
			const statements = [
				\`CREATE TABLE IF NOT EXISTS hitl_apps (
					id TEXT NOT NULL,
					org_id TEXT NOT NULL,
					title TEXT NOT NULL,
					created_by TEXT NOT NULL,
					agent_status TEXT NOT NULL,
					created_at TEXT NOT NULL,
					PRIMARY KEY (org_id, id)
				)\`,
				\`CREATE TABLE IF NOT EXISTS hitl_questions (
					id TEXT PRIMARY KEY,
					org_id TEXT NOT NULL,
					app_id TEXT NOT NULL,
					target_role TEXT NOT NULL,
					body TEXT NOT NULL,
					status TEXT NOT NULL,
					idempotency_key TEXT NOT NULL,
					assignment TEXT NOT NULL,
					created_at TEXT NOT NULL
				)\`,
				'CREATE UNIQUE INDEX IF NOT EXISTS hitl_questions_org_key ON hitl_questions (org_id, idempotency_key)',
				\`CREATE TABLE IF NOT EXISTS hitl_answers (
					question_id TEXT PRIMARY KEY,
					user_id TEXT NOT NULL,
					body TEXT NOT NULL,
					created_at TEXT NOT NULL
				)\`,
				\`CREATE TABLE IF NOT EXISTS hitl_resumes (
					id TEXT PRIMARY KEY,
					org_id TEXT NOT NULL,
					app_id TEXT NOT NULL,
					for_role TEXT NOT NULL,
					prompt TEXT NOT NULL,
					created_at TEXT NOT NULL
				)\`,
			];
			for (const sql of statements) await env.DB.prepare(sql).run();
		})();
	}
	await ready;
}

async function openQuestion(env: Env, orgId: string): Promise<QuestionRow | null> {
	return env.DB.prepare(
		\`SELECT id, org_id, app_id, target_role, body, status, idempotency_key, assignment
		 FROM hitl_questions WHERE org_id = ? AND app_id = ? AND status = 'open' LIMIT 1\`,
	)
		.bind(orgId, APP_ID)
		.first<QuestionRow>();
}

export class HitlController extends BaseController {
	static async getState(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext) {
		void request;
		const userId = context.user?.id ?? '';
		const member = await membership(env, userId);
		if (!member) return HitlController.createErrorResponse('Not found.', 404);
		await ensureSchema(env);
		const app = await env.DB.prepare(
			'SELECT title, agent_status FROM hitl_apps WHERE org_id = ? AND id = ?',
		)
			.bind(member.orgId, APP_ID)
			.first<{ title: string; agent_status: string }>();
		const question = app ? await openQuestion(env, member.orgId) : null;
		const resumes = await env.DB.prepare(
			'SELECT prompt FROM hitl_resumes WHERE org_id = ? AND app_id = ? AND for_role = ? ORDER BY created_at',
		)
			.bind(member.orgId, APP_ID, member.role)
			.all<{ prompt: string }>();
		const shared =
			app?.agent_status === 'completed'
				? [COMPLETE]
				: app?.agent_status === 'running'
					? [CONTINUED]
					: [];
		const open = question
			? question.target_role === member.role
				? { id: question.id, body: question.body, canAnswer: true, waiting: null }
				: { id: question.id, body: null, canAnswer: false, waiting: waitingLine(question.target_role) }
			: null;
		return HitlController.createSuccessResponse({
			role: member.role,
			roleLabel: roleLabel(member.role),
			app: app ? { title: app.title, agentStatus: app.agent_status } : null,
			open,
			resumes: resumes.results ?? [],
			shared,
		});
	}

	static async start(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext) {
		void request;
		const userId = context.user?.id ?? '';
		const member = await membership(env, userId);
		if (!member) return HitlController.createErrorResponse('Not found.', 404);
		if (member.role !== PM_ROLE) return HitlController.createErrorResponse('Forbidden.', 403);
		await ensureSchema(env);
		const now = new Date().toISOString();
		const existingAnswers = await env.DB.prepare(
			'SELECT id FROM hitl_questions WHERE org_id = ? AND app_id = ?',
		)
			.bind(member.orgId, APP_ID)
			.all<{ id: string }>();
		for (const row of existingAnswers.results ?? []) {
			await env.DB.prepare('DELETE FROM hitl_answers WHERE question_id = ?').bind(row.id).run();
		}
		await env.DB.prepare('DELETE FROM hitl_questions WHERE org_id = ? AND app_id = ?')
			.bind(member.orgId, APP_ID)
			.run();
		await env.DB.prepare('DELETE FROM hitl_resumes WHERE org_id = ? AND app_id = ?')
			.bind(member.orgId, APP_ID)
			.run();
		await env.DB.prepare(
			\`INSERT INTO hitl_apps (id, org_id, title, created_by, agent_status, created_at)
			 VALUES (?, ?, ?, ?, 'waiting', ?)
			 ON CONFLICT(org_id, id) DO UPDATE SET agent_status = 'waiting', created_by = excluded.created_by, created_at = excluded.created_at\`,
		)
			.bind(APP_ID, member.orgId, APP_TITLE, userId, now)
			.run();
		await env.DB.prepare(
			\`INSERT INTO hitl_questions
			 (id, org_id, app_id, target_role, body, status, idempotency_key, assignment, created_at)
			 VALUES (?, ?, ?, ?, ?, 'open', ?, 'declared', ?)\`,
		)
			.bind(crypto.randomUUID(), member.orgId, APP_ID, PM_ROLE, PM_QUESTION, \`\${member.orgId}:pm\`, now)
			.run();
		return HitlController.createSuccessResponse({ started: true });
	}

	static async answer(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext) {
		const userId = context.user?.id ?? '';
		const member = await membership(env, userId);
		if (!member) return HitlController.createErrorResponse('Not found.', 404);
		await ensureSchema(env);
		const questionId = context.pathParams.id ?? '';
		const question = await env.DB.prepare(
			\`SELECT id, org_id, app_id, target_role, body, status, idempotency_key, assignment
			 FROM hitl_questions WHERE id = ?\`,
		)
			.bind(questionId)
			.first<QuestionRow>();
		if (!question || question.org_id !== member.orgId || question.app_id !== APP_ID) {
			return HitlController.createErrorResponse('Not found.', 404);
		}
		if (question.status !== 'open') return HitlController.createErrorResponse('Closed.', 409);
		if (question.target_role !== member.role) return HitlController.createErrorResponse('Forbidden.', 403);
		const payload = (await request.json().catch(() => null)) as { answer?: unknown } | null;
		const answer = typeof payload?.answer === 'string' ? payload.answer.trim() : '';
		if (!answer) return HitlController.createErrorResponse('An answer is required.', 400);
		const now = new Date().toISOString();
		try {
			await env.DB.prepare(
				'INSERT INTO hitl_answers (question_id, user_id, body, created_at) VALUES (?, ?, ?, ?)',
			)
				.bind(question.id, userId, answer, now)
				.run();
		} catch {
			return HitlController.createErrorResponse('Closed.', 409);
		}
		await env.DB.prepare(\`UPDATE hitl_questions SET status = 'answered' WHERE id = ?\`)
			.bind(question.id)
			.run();
		const prompt = \`Question: \${question.body}\\nAnswer: \${answer}\`;
		await env.DB.prepare(
			'INSERT INTO hitl_resumes (id, org_id, app_id, for_role, prompt, created_at) VALUES (?, ?, ?, ?, ?, ?)',
		)
			.bind(crypto.randomUUID(), member.orgId, APP_ID, member.role, prompt, now)
			.run();
		if (question.target_role === PM_ROLE) {
			await env.DB.prepare(\`UPDATE hitl_apps SET agent_status = 'running' WHERE org_id = ? AND id = ?\`)
				.bind(member.orgId, APP_ID)
				.run();
			await env.DB.prepare(
				\`INSERT INTO hitl_questions
				 (id, org_id, app_id, target_role, body, status, idempotency_key, assignment, created_at)
				 VALUES (?, ?, ?, ?, ?, 'open', ?, 'declared', ?)\`,
			)
				.bind(crypto.randomUUID(), member.orgId, APP_ID, DEV_ROLE, DEV_QUESTION, \`\${member.orgId}:dev\`, now)
				.run();
		} else {
			await env.DB.prepare(\`UPDATE hitl_apps SET agent_status = 'completed' WHERE org_id = ? AND id = ?\`)
				.bind(member.orgId, APP_ID)
				.run();
		}
		return HitlController.createSuccessResponse({ saved: true });
	}
}
`;
}
