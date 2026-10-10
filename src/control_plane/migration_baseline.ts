export interface MigrationJournalEntry {
  tag: string;
  when: number;
}

/**
 * Drizzle applies every journal entry whose `when` is newer than the single
 * newest `__drizzle_migrations.created_at`. A regenerated timestamp re-runs
 * SQL that already created the tables. The stamp is the newest contiguous
 * journal entry whose objects are already present, so migrate starts after it.
 */
export function migrationBaselineWhen(
  entries: readonly MigrationJournalEntry[],
  present: Readonly<Record<string, boolean>>,
): number | null {
  let stamp: number | null = null;
  for (const entry of entries) {
    if (!Object.hasOwn(present, entry.tag)) break;
    if (!present[entry.tag]) break;
    stamp = entry.when;
  }
  return stamp;
}
