const ORGANIZATION_COLORS = [
  "#6c55dc",
  "#0f766e",
  "#c2410c",
  "#1d4ed8",
  "#be185d",
  "#047857",
  "#b45309",
  "#4338ca",
] as const;

const PRIVATE_COLOR = "#64748b";

/** One stable color per organization id. Private uses a fixed color. */
export function organizationColor(accountId: string | null): string {
  if (!accountId) return PRIVATE_COLOR;
  let hash = 0;
  for (const char of accountId) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return (
    ORGANIZATION_COLORS[hash % ORGANIZATION_COLORS.length] ?? PRIVATE_COLOR
  );
}

export function organizationInitial(name: string): string {
  const trimmed = name.trim();
  const first = trimmed[0];
  return first ? first.toUpperCase() : "?";
}
