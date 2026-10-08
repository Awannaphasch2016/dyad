// Preview-only shared sign-in. Clerk owns the session.
// wewebplus.memberships owns the gate role. The lab is not a preview host.

export function clerkKeyKind(value) {
  const key = String(value ?? "").trim();
  if (key.startsWith("pk_test_") || key.startsWith("sk_test_")) return "test";
  if (key.startsWith("pk_live_") || key.startsWith("sk_live_")) return "live";
  if (!key) return "absent";
  return "other";
}

export function neonSqlHost(databaseUrl) {
  const endpoint = new URL(databaseUrl);
  if (
    endpoint.protocol !== "postgresql:" &&
    endpoint.protocol !== "postgres:"
  ) {
    throw new Error("Membership store is unavailable.");
  }
  return endpoint.hostname.replace("-pooler.", ".");
}

export function membershipRoleSummary(rows) {
  const counts = new Map();
  for (const row of rows ?? []) {
    const role = String(row.role_id ?? "");
    if (role !== "project-manager" && role !== "developer") continue;
    counts.set(role, (counts.get(role) ?? 0) + Number(row.n ?? 1));
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([role, count]) => `${role}:${count}`)
    .join(",");
}

export function membershipReady(summary) {
  const counts = new Map();
  for (const part of String(summary ?? "").split(",")) {
    if (!part) continue;
    const [role, count] = part.split(":");
    counts.set(role, Number(count));
  }
  return counts.get("developer") >= 1 && counts.get("project-manager") >= 1;
}

export function sharedSession({ userId = "", memberships = [] } = {}) {
  if (!String(userId ?? "").trim()) {
    return { signedIn: false, organization: null, role: null, userId: null };
  }
  const usable = memberships.filter((row) => {
    return row.role_id === "project-manager" || row.role_id === "developer";
  });
  if (usable.length !== 1) {
    return {
      signedIn: true,
      organization: null,
      role: null,
      userId: String(userId),
    };
  }
  const row = usable[0];
  return {
    signedIn: true,
    organization: row.organization ?? null,
    role: row.role_id === "project-manager" ? "Project Manager" : "Developer",
    userId: String(userId),
  };
}

function requireAnchor(source, anchor, label) {
  if (!source.includes(anchor)) {
    throw new Error(`shared sign-in patch missed ${label}`);
  }
}

export function patchAuthRoutes(source) {
  const importAnchor =
    "import { AuthController } from '../controllers/auth/controller';";
  const routeAnchor =
    "    authRouter.post('/register', setAuthLevel(AuthConfig.public), adaptController(AuthController, AuthController.register));";
  requireAnchor(source, importAnchor, "auth import");
  requireAnchor(source, routeAnchor, "auth routes");
  return source
    .replace(
      importAnchor,
      `${importAnchor}\nimport { SharedSignInController } from '../controllers/auth/sharedSignIn';`,
    )
    .replace(
      routeAnchor,
      [
        "    authRouter.get('/clerk', setAuthLevel(AuthConfig.public), adaptController(SharedSignInController, SharedSignInController.clerk));",
        "    authRouter.get('/session', setAuthLevel(AuthConfig.public), adaptController(SharedSignInController, SharedSignInController.session));",
        "    authRouter.post('/shared', setAuthLevel(AuthConfig.public), adaptController(SharedSignInController, SharedSignInController.shared));",
        "    authRouter.get('/shared/last', setAuthLevel(AuthConfig.public), adaptController(SharedSignInController, SharedSignInController.last));",
        "    authRouter.get('/shared/miss', setAuthLevel(AuthConfig.public), adaptController(SharedSignInController, SharedSignInController.miss));",
        routeAnchor,
      ].join("\n"),
    );
}

export function patchLoginModal(source) {
  const flags = [
    "\tconst hasEmailAuth = emailAuthEnabled && !!onEmailLogin;",
    "\tconst hasRegistration = emailAuthEnabled && !!onRegister;",
    "\tconst showGitHub = authProviders?.github && hasOAuth;",
    "\tconst showGoogle = authProviders?.google && hasOAuth;",
    "\tconst showCloudflare = authProviders?.cloudflare && hasOAuth;",
  ].join("\n");
  const options =
    "\t\t\t\t<div className={cn('p-6 space-y-4 pt-6')}>\n\t\t\t\t\t{/* GitHub */}";
  const exportAnchor = "export function LoginModal";
  const reactImport = "import { useState } from 'react';";
  requireAnchor(source, flags, "login flags");
  requireAnchor(source, options, "login options");
  requireAnchor(source, exportAnchor, "login export");
  requireAnchor(source, reactImport, "login react import");
  return source
    .replace(reactImport, "import { useEffect, useState } from 'react';")
    .replace(exportAnchor, () => `${sharedClerkHelpers()}\n${exportAnchor}`)
    .replace(
      flags,
      `${flags.replaceAll("&&", "&& false &&")}\n\tuseEffect(() => {\n\t\tif (!isOpen) return;\n\t\tvoid startSharedSignIn();\n\t}, [isOpen]);`,
    )
    .replace(
      options,
      `\t\t\t\t<div className={cn('p-6 space-y-4 pt-6')}>\n\t\t\t\t\t<Button\n\t\t\t\t\t\ttype="button"\n\t\t\t\t\t\tvariant="primary"\n\t\t\t\t\t\tclassName="w-full justify-center"\n\t\t\t\t\t\tonClick={() => {\n\t\t\t\t\t\t\tvoid startSharedSignIn();\n\t\t\t\t\t\t}}\n\t\t\t\t\t>\n\t\t\t\t\t\tSign in\n\t\t\t\t\t</Button>\n\t\t\t\t\t{/* GitHub */}`,
    );
}

export function patchGlobalHeader(source) {
  const exportAnchor = "export function GlobalHeader() {";
  const modalImport =
    "import { useAuthModal } from '../auth/AuthModalProvider';";
  const modalHook = "\tconst { showAuthModal } = useAuthModal();";
  const click = "onClick={() => showAuthModal()}";
  requireAnchor(source, exportAnchor, "header export");
  requireAnchor(source, modalImport, "header modal import");
  requireAnchor(source, modalHook, "header modal hook");
  requireAnchor(source, click, "header sign-in click");
  return source
    .replace(modalImport, "")
    .replace(modalHook, "")
    .replace(exportAnchor, () => `${sharedClerkHelpers()}\n${exportAnchor}`)
    .replace(
      click,
      "onClick={() => {\n\t\t\t\t\t\t\t\tvoid startSharedSignIn();\n\t\t\t\t\t\t\t}}",
    );
}

const CLERK_BROWSER_HOSTS = [
  "https://*.clerk.accounts.dev",
  "https://*.accounts.dev",
  "https://*.clerk.com",
  "https://challenges.cloudflare.com",
];

export function patchClerkDocument(source) {
  const scriptSrc =
    "script-src 'self' 'unsafe-inline' blob: https://cdnjs.cloudflare.com https://cdn.tailwindcss.com https://esm.sh https://static.cloudflareinsights.com;";
  requireAnchor(source, scriptSrc, "document script policy");
  return source.replace(
    scriptSrc,
    `script-src 'self' 'unsafe-inline' blob: https://cdnjs.cloudflare.com https://cdn.tailwindcss.com https://esm.sh https://static.cloudflareinsights.com ${CLERK_BROWSER_HOSTS.join(" ")};`,
  );
}

export function patchClerkSecurity(source) {
  const scriptAnchor = `"'strict-dynamic'",`;
  const connectAnchor = `"https://api.cloudflare.com"`;
  const frameAnchor = `frameSrc: ["'none'"],`;
  const imageAnchor = `"https://lh3.googleusercontent.com", // Google avatars`;
  const workerAnchor = `workerSrc: ["'self'", "blob:"],`;
  const embedAnchor = `crossOriginEmbedderPolicy: 'require-corp',`;
  const openerAnchor = `crossOriginOpenerPolicy: 'same-origin',`;
  for (const [anchor, label] of [
    [scriptAnchor, "script policy"],
    [connectAnchor, "connect policy"],
    [frameAnchor, "frame policy"],
    [imageAnchor, "image policy"],
    [workerAnchor, "worker policy"],
    [embedAnchor, "embedder policy"],
    [openerAnchor, "opener policy"],
  ]) {
    requireAnchor(source, anchor, label);
  }
  const hosts = CLERK_BROWSER_HOSTS.map((host) => `"${host}"`).join(", ");
  return source
    .replace(scriptAnchor, `${scriptAnchor}\n                ${hosts},`)
    .replace(connectAnchor, `${connectAnchor},\n        ${hosts}`)
    .replace(frameAnchor, `frameSrc: ["'self'", ${hosts}],`)
    .replace(
      imageAnchor,
      `${imageAnchor}\n                "https://img.clerk.com",`,
    )
    .replace(workerAnchor, `workerSrc: ["'self'", "blob:", ${hosts}],`)
    .replace(embedAnchor, `crossOriginEmbedderPolicy: false,`)
    .replace(
      openerAnchor,
      `crossOriginOpenerPolicy: 'same-origin-allow-popups',`,
    );
}

export function patchAuthContext(source) {
  const sessionAnchor =
    "async function fetchAuthSession(): Promise<CachedAuthSession | null> {";
  const logoutAnchor = "\t\t\ttry {\n\t\t\t\tawait apiClient.logout();";
  requireAnchor(source, sessionAnchor, "auth session");
  requireAnchor(source, logoutAnchor, "logout");
  return source
    .replace(
      sessionAnchor,
      () =>
        `${sharedClerkHelpers()}\n${sessionAnchor.replace(
          "async function fetchAuthSession(): Promise<CachedAuthSession | null> {",
          "async function fetchAuthSession(): Promise<CachedAuthSession | null> {\n\tconst sharedToken = await sharedClerkToken();\n\tif (sessionStorage.getItem('vibesdk-shared-pending')) {\n\t\tsessionStorage.removeItem('vibesdk-shared-pending');\n\t\tif (!sharedToken) void fetch('/api/auth/shared/miss', { credentials: 'include' });\n\t}",
        )}`,
    )
    .replace(
      "\t\tconst response = await apiClient.getProfile(true);\n\n\t\tif (response.success && response.data?.user) {\n\t\t\treturn buildSessionFromProfile(response.data);\n\t\t}\n\n\t\treturn null;",
      `		if (sharedToken) {
			const exchanged = await fetch('/api/auth/shared', {
				method: 'POST',
				credentials: 'include',
				headers: { Authorization: \`Bearer \${sharedToken}\` },
			});
			if (exchanged.status === 403) return null;
			if (exchanged.ok) {
				const payload = await exchanged.json();
				if (payload?.success && payload.data?.user) {
					if (payload.data.organization && payload.data.role) {
						sessionStorage.setItem(
							'vibesdk-shared-role',
							\`\${payload.data.organization} · \${payload.data.role}\`,
						);
					}
					return buildSessionFromLogin(payload.data);
				}
			}
		}
		const response = await apiClient.getProfile(true);

		if (response.success && response.data?.user) {
			return buildSessionFromProfile(response.data);
		}

		return null;`,
    )
    .replace(
      logoutAnchor,
      `\t\t\ttry {\n\t\t\t\tconst clerk = (window as Window & { Clerk?: { signOut?: () => Promise<void> } }).Clerk;\n\t\t\t\tif (clerk?.signOut) await clerk.signOut();\n\t\t\t\tsessionStorage.removeItem('vibesdk-shared-role');\n\t\t\t\tawait apiClient.logout();`,
    );
}

export function patchAuthButton(source) {
  const importAnchor = "import { useAuth } from '../../contexts/auth-context';";
  const nameAnchor = "{user.displayName || 'User'}";
  requireAnchor(source, importAnchor, "auth button import");
  requireAnchor(source, nameAnchor, "auth button name");
  return source
    .replace(
      importAnchor,
      `${importAnchor}\nimport { SharedRole } from './shared-role';`,
    )
    .replace(
      nameAnchor,
      `<span className="flex min-w-0 flex-col"><span>{user.displayName || 'User'}</span><SharedRole /></span>`,
    );
}

function sharedClerkHelpers() {
  return `async function sharedClerkPublishableKey(): Promise<string | null> {
	const keyResponse = await fetch('/api/auth/clerk', { credentials: 'include' });
	if (!keyResponse.ok) return null;
	const body = await keyResponse.json();
	const publishableKey = body.data?.publishableKey;
	if (typeof publishableKey !== 'string' || !publishableKey.startsWith('pk_test_')) {
		return null;
	}
	return publishableKey;
}

async function sharedClerkToken(): Promise<string | null> {
	try {
		const publishableKey = await sharedClerkPublishableKey();
		if (!publishableKey) return null;
		const frontendApi = atob(publishableKey.slice('pk_test_'.length)).replace(/\\$$/, '');
		const browserWindow = window as Window & {
			Clerk?: {
				load: (options: { publishableKey: string }) => Promise<void>;
				session?: { getToken: () => Promise<string | null> } | null;
			};
		};
		if (!browserWindow.Clerk) {
			await new Promise<void>((resolve, reject) => {
				const script = document.createElement('script');
				script.async = true;
				script.crossOrigin = 'anonymous';
				script.src = \`https://\${frontendApi}/npm/@clerk/clerk-js@5/dist/clerk.browser.js\`;
				script.setAttribute('data-clerk-publishable-key', publishableKey);
				script.onload = () => resolve();
				script.onerror = () => reject(new Error('Sign in is not available.'));
				document.head.appendChild(script);
			});
		}
		const clerk = browserWindow.Clerk;
		if (!clerk) return null;
		await clerk.load({ publishableKey });
		return (await clerk.session?.getToken()) ?? null;
	} catch {
		return null;
	}
}

async function startSharedSignIn(): Promise<void> {
	const publishableKey = await sharedClerkPublishableKey();
	if (!publishableKey) return;
	const token = await sharedClerkToken();
	if (token) {
		window.location.reload();
		return;
	}
	const clerk = (window as Window & {
		Clerk?: {
			redirectToSignIn?: (options: {
				redirectUrl: string;
				signInForceRedirectUrl: string;
				signInFallbackRedirectUrl: string;
			}) => Promise<unknown>;
		};
	}).Clerk;
	const back = window.location.href;
	if (!clerk?.redirectToSignIn) return;
	sessionStorage.setItem('vibesdk-shared-pending', '1');
	await clerk.redirectToSignIn({
		redirectUrl: back,
		signInForceRedirectUrl: back,
		signInFallbackRedirectUrl: back,
	});
}`;
}

export function sharedRoleSource() {
  return `import { useEffect, useState } from 'react';

export function SharedRole() {
	const [label, setLabel] = useState('');
	useEffect(() => {
		setLabel(sessionStorage.getItem('vibesdk-shared-role') ?? '');
	}, []);
	if (!label) return null;
	return <span className="block text-xs text-kumo-subtle">{label}</span>;
}
`;
}

export function sharedSignInSource() {
  return `import { eq } from 'drizzle-orm';
import { createDatabaseService } from '../../../database/database';
import * as schema from '../../../database/schema';
import { SessionService } from '../../../database/services/SessionService';
import { BaseController } from '../baseController';
import {
	formatAuthResponse,
	mapUserResponse,
	setSecureAuthCookies,
} from '../../../utils/authUtils';

type GateRow = { org_id?: string; role_id?: string; organization?: string | null };

const LAST_REFUSAL_KEY = 'shared-sign-in:last';

class SignInRefusal extends Error {
	constructor(readonly code: string) {
		super('Sign in to continue.');
	}
}

async function recordAttempt(env: Env, code: string): Promise<void> {
	try {
		await env.VibecoderStore.put(
			LAST_REFUSAL_KEY,
			JSON.stringify({ code, at: new Date().toISOString() }),
			{ expirationTtl: 86400 },
		);
	} catch {
		// The attempt record is diagnostic only.
	}
}

function refusalCode(error: unknown): string {
	return error instanceof SignInRefusal ? error.code : 'unexpected';
}

function binding(env: Env, name: string): string {
	return String((env as unknown as Record<string, unknown>)[name] ?? '').trim();
}

function sessionToken(authorization: string | null, cookie: string | null): string {
	const bearer = authorization?.startsWith('Bearer ')
		? authorization.slice('Bearer '.length).trim()
		: '';
	if (bearer) return bearer;
	const match = /(?:^|;\\s*)__session=([^;]+)/.exec(cookie ?? '');
	return match ? decodeURIComponent(match[1]) : '';
}

async function clerkIdentity(env: Env, token: string): Promise<{ userId: string; email: string; name: string }> {
	const secret = binding(env, 'CLERK_SECRET_KEY');
	const publishable = binding(env, 'CLERK_PUBLISHABLE_KEY');
	if (!secret.startsWith('sk_test_') || !publishable.startsWith('pk_test_')) {
		throw new SignInRefusal('clerk-keys');
	}
	const frontendApi = atob(publishable.slice('pk_test_'.length)).replace(/\\$$/, '');
	const jwksResponse = await fetch(\`https://\${frontendApi}/.well-known/jwks.json\`);
	if (!jwksResponse.ok) throw new SignInRefusal('jwks');
	const jwks = (await jwksResponse.json()) as { keys: (JsonWebKey & { kid?: string })[] };
	const [headerPart, payloadPart, signaturePart] = token.split('.');
	if (!headerPart || !payloadPart || !signaturePart) throw new SignInRefusal('token-shape');
	const decode = (value: string) => {
		const padded = value.replace(/-/g, '+').replace(/_/g, '/');
		return atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
	};
	const header = JSON.parse(decode(headerPart)) as { kid?: string };
	const jwk = jwks.keys.find((key) => key.kid === header.kid);
	if (!jwk) throw new SignInRefusal('token-key');
	const key = await crypto.subtle.importKey(
		'jwk',
		jwk,
		{ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
		false,
		['verify'],
	);
	const signature = Uint8Array.from(decode(signaturePart), (char) => char.charCodeAt(0));
	const signed = await crypto.subtle.verify(
		'RSASSA-PKCS1-v1_5',
		key,
		signature,
		new TextEncoder().encode(\`\${headerPart}.\${payloadPart}\`),
	);
	if (!signed) throw new SignInRefusal('token-signature');
	const payload = JSON.parse(decode(payloadPart)) as { sub?: string; exp?: number };
	if (typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now()) {
		throw new SignInRefusal('token-expired');
	}
	if (!payload.sub) throw new SignInRefusal('token-subject');
	const userResponse = await fetch(\`https://api.clerk.com/v1/users/\${encodeURIComponent(payload.sub)}\`, {
		headers: { Authorization: \`Bearer \${secret}\` },
	});
	if (!userResponse.ok) throw new SignInRefusal(\`clerk-user-\${userResponse.status}\`);
	const user = (await userResponse.json()) as {
		first_name?: string | null;
		last_name?: string | null;
		primary_email_address_id?: string;
		email_addresses?: { id: string; email_address: string }[];
	};
	const email =
		user.email_addresses?.find((item) => item.id === user.primary_email_address_id)
			?.email_address ?? user.email_addresses?.[0]?.email_address;
	if (!email) throw new SignInRefusal('clerk-email');
	const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
	return { userId: payload.sub, email: email.toLowerCase(), name: name || email.split('@')[0] };
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
	if (!response.ok) throw new SignInRefusal(\`membership-query-\${response.status}\`);
	const payload = (await response.json()) as {
		fields?: { name: string }[];
		rows?: unknown[];
	};
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

async function gateFor(env: Env, userId: string): Promise<{
	signedIn: true;
	organization: string | null;
	role: string | null;
	refusal: string | null;
}> {
	const databaseUrl = binding(env, 'WEWEBPLUS_DATABASE_URL');
	if (!databaseUrl) {
		return { signedIn: true, organization: null, role: null, refusal: 'membership-store' };
	}
	const memberships = await neonQuery(
		databaseUrl,
		'select org_id, role_id from wewebplus.memberships where user_id = $1',
		[userId],
	);
	const usable = memberships.filter(
		(row) => row.role_id === 'project-manager' || row.role_id === 'developer',
	);
	if (usable.length !== 1) {
		return {
			signedIn: true,
			organization: null,
			role: null,
			refusal: \`gate-roles-\${usable.length}\`,
		};
	}
	const orgId = String(usable[0].org_id ?? '');
	const secret = binding(env, 'CLERK_SECRET_KEY');
	let organization: string | null = null;
	let refusal: string | null = orgId ? null : 'organization-id';
	if (secret && orgId) {
		const response = await fetch(\`https://api.clerk.com/v1/organizations/\${encodeURIComponent(orgId)}\`, {
			headers: { Authorization: \`Bearer \${secret}\` },
		});
		if (response.ok) {
			const org = (await response.json()) as { name?: string };
			organization = org.name ?? null;
			if (!organization) refusal = 'organization-name';
		} else {
			refusal = \`organization-\${response.status}\`;
		}
	}
	return {
		signedIn: true,
		organization,
		role: usable[0].role_id === 'project-manager' ? 'Project Manager' : 'Developer',
		refusal,
	};
}

export class SharedSignInController extends BaseController {
	static async clerk(_request: Request, env: Env): Promise<Response> {
		const key = binding(env, 'CLERK_PUBLISHABLE_KEY');
		if (!key.startsWith('pk_test_')) {
			return SharedSignInController.createErrorResponse('Sign in is not available.', 404);
		}
		return SharedSignInController.createSuccessResponse({ publishableKey: key });
	}

	static async session(request: Request, env: Env): Promise<Response> {
		const token = sessionToken(request.headers.get('Authorization'), request.headers.get('Cookie'));
		if (!token) {
			return Response.json({ signedIn: false, organization: null, role: null });
		}
		try {
			const identity = await clerkIdentity(env, token);
			const gate = await gateFor(env, identity.userId);
			if (!gate.role) {
				return Response.json({ signedIn: true, organization: null, role: null });
			}
			return Response.json({
				signedIn: true,
				organization: gate.organization,
				role: gate.role,
			});
		} catch {
			return Response.json({ signedIn: false, organization: null, role: null });
		}
	}

	static async miss(_request: Request, env: Env): Promise<Response> {
		await recordAttempt(env, 'browser-no-clerk-token');
		return Response.json({ recorded: true });
	}

	static async last(_request: Request, env: Env): Promise<Response> {
		const stored = await env.VibecoderStore.get(LAST_REFUSAL_KEY);
		return Response.json(stored ? JSON.parse(stored) : { code: null, at: null });
	}

	static async shared(request: Request, env: Env): Promise<Response> {
		const token = sessionToken(request.headers.get('Authorization'), request.headers.get('Cookie'));
		if (!token) {
			await recordAttempt(env, 'no-token');
			return SharedSignInController.createErrorResponse('Sign in to continue.', 401);
		}
		try {
			const identity = await clerkIdentity(env, token);
			const gate = await gateFor(env, identity.userId);
			if (!gate.role || !gate.organization) {
				await recordAttempt(env, gate.refusal ?? 'gate');
				return SharedSignInController.createErrorResponse('Sign in to continue.', 403);
			}
			const database = createDatabaseService(env).db;
			let user = await database
				.select()
				.from(schema.users)
				.where(eq(schema.users.id, identity.userId))
				.get();
			if (!user) {
				const byEmail = await database
					.select()
					.from(schema.users)
					.where(eq(schema.users.email, identity.email))
					.get();
				if (byEmail) {
					await recordAttempt(env, 'email-taken');
					return SharedSignInController.createErrorResponse('Sign in to continue.', 403);
				}
				const now = new Date();
				try {
					await database.insert(schema.users).values({
						id: identity.userId,
						email: identity.email,
						displayName: identity.name,
						emailVerified: true,
						provider: 'email',
						providerId: identity.userId,
						createdAt: now,
						updatedAt: now,
					});
				} catch {
					throw new SignInRefusal('user-insert');
				}
				user = await database
					.select()
					.from(schema.users)
					.where(eq(schema.users.id, identity.userId))
					.get();
			}
			if (!user) {
				await recordAttempt(env, 'user-row');
				return SharedSignInController.createErrorResponse('Sign in to continue.', 403);
			}
			const sessionService = new SessionService(env);
			let created: Awaited<ReturnType<SessionService['createSession']>>;
			try {
				created = await sessionService.createSession(identity.userId, request);
			} catch {
				throw new SignInRefusal('session-create');
			}
			const response = SharedSignInController.createSuccessResponse({
				...formatAuthResponse(mapUserResponse(user), created.session.sessionId, created.session.expiresAt),
				organization: gate.organization,
				role: gate.role,
			});
			setSecureAuthCookies(response, {
				accessToken: created.accessToken,
				accessTokenExpiry: SessionService.config.sessionTTL,
			});
			await recordAttempt(env, 'ok');
			return response;
		} catch (error) {
			await recordAttempt(env, refusalCode(error));
			return SharedSignInController.createErrorResponse('Sign in to continue.', 401);
		}
	}
}
`;
}

async function membershipRoles(databaseUrl, fetchImpl) {
  const host = neonSqlHost(databaseUrl);
  const direct = new URL(databaseUrl);
  direct.hostname = host;
  const response = await fetchImpl(`https://${host}/sql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Neon-Connection-String": direct.toString(),
    },
    body: JSON.stringify({
      query:
        "select role_id, count(*)::int as n from wewebplus.memberships group by role_id",
      params: [],
    }),
  });
  if (!response.ok) {
    throw new Error(`Membership store is unavailable (${response.status})`);
  }
  const payload = await response.json();
  const fields = payload.fields ?? [];
  return (payload.rows ?? []).map((row) => {
    if (!Array.isArray(row)) return row;
    const record = {};
    fields.forEach((field, index) => {
      record[field.name] = row[index];
    });
    return record;
  });
}

export async function assertSharedSignIn(env, fetchImpl = fetch) {
  const publishable = String(env.CLERK_PUBLISHABLE_KEY ?? "").trim();
  const secret = String(env.CLERK_SECRET_KEY ?? "").trim();
  const databaseUrl = String(env.WEWEBPLUS_DATABASE_URL ?? "").trim();
  const publishableKind = clerkKeyKind(publishable);
  const secretKind = clerkKeyKind(secret);
  console.log(`clerk_publishable=${publishableKind}`);
  console.log(`clerk_secret=${secretKind}`);
  if (publishableKind !== "test" || secretKind !== "test") {
    throw new Error("Clerk development keys are not available");
  }
  if (!databaseUrl) {
    throw new Error("WEWEBPLUS_DATABASE_URL is not available");
  }
  const summary = membershipRoleSummary(
    await membershipRoles(databaseUrl, fetchImpl),
  );
  console.log(`membership_roles=${summary || "none"}`);
  if (!membershipReady(summary)) {
    throw new Error("Wewebplus gate roles are not ready");
  }
  return { publishable, secret, databaseUrl };
}
