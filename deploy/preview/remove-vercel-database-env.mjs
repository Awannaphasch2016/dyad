// Delete WEWEBPLUS_DATABASE_URL from Vercel project dyad.
// Uses the project-scoped token. Values are never printed.

import { pathToFileURL } from "node:url";
import { removeProjectDatabaseEnv } from "./vercel.mjs";

export async function removeCanaryDatabaseEnv(token) {
  if (!token) throw new Error("VERCEL_ANAK2_TOKEN absent");
  return removeProjectDatabaseEnv({ token, project: "dyad" });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const removed = await removeCanaryDatabaseEnv(
      process.env.VERCEL_ANAK2_TOKEN ?? "",
    );
    console.log(
      `vercel_database_env_removed=${removed.removed} project=${removed.project} targets=${removed.targets.join(",") || "none"}`,
    );
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    console.error(
      text.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://redacted"),
    );
    process.exit(1);
  }
}
