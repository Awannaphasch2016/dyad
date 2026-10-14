export type ControlPlanePresence = {
  apps: boolean;
  roles: boolean;
  gateResolvedAt: boolean;
  formulaRevisions: boolean;
};

const STAMP_ORDER: Array<[string, keyof ControlPlanePresence]> = [
  ["0000_control_plane", "apps"],
  ["0001_hitl", "roles"],
  ["0002_gate_resolved_at", "gateResolvedAt"],
  ["0003_formula_revisions", "formulaRevisions"],
];

/** Tags whose objects are already in the database, in journal order. */
export function controlPlaneStampTags(
  presence: ControlPlanePresence,
): string[] {
  const tags: string[] = [];
  for (const [tag, key] of STAMP_ORDER) {
    if (!presence[key]) break;
    tags.push(tag);
  }
  return tags;
}
