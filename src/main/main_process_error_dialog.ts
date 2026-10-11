/**
 * Desktop crashes still open the native error box. Preview and Gas City set
 * DYAD_BROWSER_BRIDGE=1 and have nobody to dismiss that box. showErrorBox
 * blocks the main process until OK, so the dialog stays off there.
 */
export function showMainProcessErrorDialog(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.DYAD_BROWSER_BRIDGE !== "1";
}
