import fs from "node:fs";
import path from "node:path";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getCurrentCommitHash } from "./git_utils";

/** A turn may read Git only after the project folder and its repository exist. */
export function assertProjectReadyForGitRead(appPath: string): void {
  if (!fs.existsSync(appPath)) {
    throw new DyadError(
      "This project's files are missing.",
      DyadErrorKind.NotFound,
    );
  }
  if (!fs.existsSync(path.join(appPath, ".git"))) {
    throw new DyadError(
      "This project is not ready.",
      DyadErrorKind.Precondition,
    );
  }
}

export async function readProjectCommitHash(appPath: string): Promise<string> {
  assertProjectReadyForGitRead(appPath);
  return getCurrentCommitHash({ path: appPath });
}
