// Session decision for Forma's copy of the shared sign-in.
// Clerk owns the session. wewebplus.memberships owns the gate role.
// The workspace password is not a session.

export const PROJECT_MANAGER_ROLE = "project-manager";
export const DEVELOPER_ROLE = "developer";

export function clerkKeyKind(value) {
  const key = String(value ?? "").trim();
  if (key.startsWith("pk_test_") || key.startsWith("sk_test_")) return "test";
  if (key.startsWith("pk_live_") || key.startsWith("sk_live_")) return "live";
  if (!key) return "absent";
  return "other";
}

export function clerkPublishable(value) {
  const key = String(value ?? "").trim();
  if (!key.startsWith("pk_test_")) {
    return { status: 404, body: { error: "Sign in is not available." } };
  }
  return { status: 200, body: { publishableKey: key } };
}

function gateRole(roleId) {
  if (roleId === PROJECT_MANAGER_ROLE) return "Project Manager";
  if (roleId === DEVELOPER_ROLE) return "Developer";
  return "";
}

export function formaSession({
  userId = "",
  memberships = [],
  activeOrgIds = null,
  orgNames = {},
} = {}) {
  if (!String(userId ?? "").trim()) {
    return { signedIn: false, organization: null, role: null, userId: null };
  }
  const active = activeOrgIds ? new Set([...activeOrgIds].map(String)) : null;
  const usable = memberships.filter((row) => {
    if (!gateRole(row.role_id)) return false;
    if (active && !active.has(String(row.org_id))) return false;
    return true;
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
  const orgId = String(row.org_id);
  return {
    signedIn: true,
    organization: orgNames[orgId] ?? null,
    role: gateRole(row.role_id),
    userId: String(userId),
  };
}

export function formaOwnerId(session) {
  if (!session?.signedIn || !session.role || !session.userId) return null;
  return session.userId;
}
