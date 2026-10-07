// Remove only the database URL from the Vercel dyad project. The value is
// never printed.

export function removalTarget(project, key) {
  if (project !== "dyad") {
    throw new Error("Refusing to edit a Vercel project other than dyad");
  }
  if (key !== "WEWEBPLUS_DATABASE_URL") {
    throw new Error("Refusing to remove any variable except the database URL");
  }
  return { project, key };
}
