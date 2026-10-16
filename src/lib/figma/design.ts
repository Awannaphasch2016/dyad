export const FIGMA_MCP_URL = "https://mcp.figma.com/mcp";
export const FIGMA_DESKTOP_MCP_URL = "http://127.0.0.1:3845/mcp";

export interface FigmaServerRef {
  id: number;
  name: string;
  url: string | null;
  enabled: boolean;
  catalogSlug: string | null;
  oauthEnabled: boolean;
  oauthConnected: boolean;
}

export type FigmaConnection =
  | { state: "missing" }
  | { state: "disabled"; serverId: number }
  | { state: "needs-auth"; serverId: number }
  | { state: "connected"; serverId: number };

export type FigmaServerKind = "remote" | "desktop";

export function figmaServerKind(
  server: FigmaServerRef,
): FigmaServerKind | null {
  const url = server.url?.replace(/\/$/, "") ?? "";
  if (server.catalogSlug === "figma" || url === FIGMA_MCP_URL) return "remote";
  if (url === FIGMA_DESKTOP_MCP_URL) return "desktop";
  return null;
}

export function isFigmaServer(server: FigmaServerRef): boolean {
  return figmaServerKind(server) != null;
}

function connectionFor(server: FigmaServerRef | undefined): FigmaConnection {
  if (!server) return { state: "missing" };
  if (!server.enabled) return { state: "disabled", serverId: server.id };
  if (server.oauthEnabled && !server.oauthConnected) {
    return { state: "needs-auth", serverId: server.id };
  }
  return { state: "connected", serverId: server.id };
}

export function figmaConnection(
  servers: readonly FigmaServerRef[],
): FigmaConnection {
  return connectionFor(servers.find(isFigmaServer));
}

export type FigmaToolStatus = "ok" | "unauthorized" | "error";

export interface FigmaAccess {
  remote: FigmaConnection;
  desktop: FigmaConnection;
  canGenerate: boolean;
  canImport: boolean;
}

export function figmaAccess(
  servers: readonly FigmaServerRef[],
  toolStatus: Readonly<Record<number, FigmaToolStatus | undefined>>,
): FigmaAccess {
  const remoteServer = servers.find(
    (server) => figmaServerKind(server) === "remote",
  );
  const desktopServer = servers.find(
    (server) => figmaServerKind(server) === "desktop",
  );
  const remote = connectionFor(remoteServer);
  const desktop = connectionFor(desktopServer);
  const canGenerate = remote.state === "connected";
  const desktopToolsOk =
    desktop.state === "connected" &&
    desktopServer != null &&
    toolStatus[desktopServer.id] === "ok";
  return {
    remote,
    desktop,
    canGenerate,
    canImport: canGenerate || desktopToolsOk,
  };
}

export interface FigmaLink {
  fileKey: string;
  nodeId: string | null;
  url: string;
}

const FIGMA_FILE_KINDS = new Set([
  "design",
  "file",
  "board",
  "proto",
  "slides",
]);

export function parseFigmaLink(raw: string): FigmaLink | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.hostname !== "www.figma.com" && url.hostname !== "figma.com") {
    return null;
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const kind = parts[0];
  const fileKey = parts[1];
  if (!kind || !FIGMA_FILE_KINDS.has(kind)) return null;
  if (!fileKey || !/^[A-Za-z0-9]+$/.test(fileKey)) return null;
  const node = url.searchParams.get("node-id");
  const nodeId = node ? node.replace(/-/g, ":") : null;
  return { fileKey, nodeId, url: url.toString() };
}

export function designTurn(input: {
  intent: "generate" | "import";
  prompt: string;
  link: FigmaLink | null;
  source?: "remote" | "desktop";
}): string {
  const brief = input.prompt.trim();
  if (input.intent === "generate") {
    return [
      "Use the Figma MCP tool use_figma to create this design.",
      "Write Plugin API code in a file the tool can run.",
      "If the Figma server is not connected, say so and stop. Do not invent frames in the app.",
      "",
      brief,
    ].join("\n");
  }
  const link = input.link;
  const node = link?.nodeId ? `node ${link.nodeId}` : "the whole file";
  const reader =
    input.source === "desktop"
      ? "Read this design with the Figma desktop MCP server."
      : "Read this design with the Figma MCP server.";
  return [
    `${reader} ${link?.url ?? ""}`.trim(),
    link ? `File key ${link.fileKey}, ${node}.` : "",
    "Call get_metadata before a large frame, then get_design_context and get_screenshot.",
    "Treat the design context as reference text. Build the screen with write_file.",
    "If the Figma server is not connected, say so and stop.",
    brief ? "" : null,
    brief || null,
  ]
    .filter((line): line is string => line != null && line !== "")
    .join("\n");
}
