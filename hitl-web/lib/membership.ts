const WEWEBPLUS_ORG_ID = "org_3JuOz4PCITqmueMeKYhcFUXAEIH";

export type Membership = {
  orgId: string;
  roleId: "project-manager" | "developer" | null;
};

export function chooseMembership(
  rows: Membership[],
  sessionOrgId: string | null,
): Membership | null {
  if (rows.length === 0) return null;
  if (sessionOrgId) {
    return rows.find((row) => row.orgId === sessionOrgId) ?? null;
  }
  const wewebplus = rows.find((row) => row.orgId === WEWEBPLUS_ORG_ID);
  if (wewebplus) return wewebplus;
  return rows.length === 1 ? rows[0] : null;
}
