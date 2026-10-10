import { isAdminRoleId, type AdminRoleId } from "@/lib/adminAccess";

/** The agent writes this heading, then the question, then stops. */
export interface FactoryRequestMarker {
  role: AdminRoleId;
  body: string;
}

const HEADING = /^\s*#{1,4}\s*(.+?)\s*$/;
const FENCE = /^\s*```/;

function headingText(line: string): string | null {
  const match = HEADING.exec(line);
  if (!match) return null;
  return match[1].replace(/\*/g, "").replace(/:\s*$/, "").trim().toLowerCase();
}

/**
 * The last `## Request for <role>` outside a code fence. The role is one of
 * the two factory roles. An empty body, an unknown role, or a heading that
 * only appears inside a fence or a thinking block is not a request.
 */
export function extractFactoryRequest(
  content: string,
): FactoryRequestMarker | null {
  const withoutThinking = content.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const lines = withoutThinking.split(/\r?\n/);
  let fenced = false;
  let last: { role: AdminRoleId; start: number } | null = null;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const text = headingText(line);
    if (!text) continue;
    const role = /^request for\s+(.+)$/.exec(text)?.[1];
    if (!role || !isAdminRoleId(role)) continue;
    last = { role, start: index };
  }
  if (!last) return null;

  fenced = false;
  const body: string[] = [];
  for (const line of lines.slice(last.start + 1)) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      body.push(line);
      continue;
    }
    if (!fenced && headingText(line) != null) break;
    body.push(line);
  }
  const text = body.join("\n").trim();
  return text.length > 0 ? { role: last.role, body: text } : null;
}
