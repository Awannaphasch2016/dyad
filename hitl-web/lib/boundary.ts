/**
 * IPC domains the Electron renderer still reaches through preload.
 * The web frontend does not call these channels. GasCity is the only
 * network peer, and Electron is invoked only for the domains marked
 * "electron".
 */
export const IPC_DOMAINS = [
  "account",
  "agent",
  "app",
  "appBlueprint",
  "appCollection",
  "audio",
  "capacitor",
  "chat",
  "clerk",
  "cloudflare",
  "connectionFlow",
  "context",
  "coolify",
  "coolifySetup",
  "distributedMachines",
  "factory",
  "factoryHost",
  "firstPrompt",
  "freeAgentQuota",
  "freeModelQuota",
  "git",
  "github",
  "help",
  "imageGeneration",
  "import",
  "knowledge",
  "languageModel",
  "mcp",
  "media",
  "migration",
  "misc",
  "neon",
  "plan",
  "previewView",
  "prompt",
  "proposal",
  "recording",
  "security",
  "settings",
  "supabase",
  "system",
  "template",
  "terminal",
  "tests",
  "upgrade",
  "userInput",
  "vercel",
  "version",
  "visualEditing",
  "windowInfrastructure",
] as const;

export type IpcDomain = (typeof IPC_DOMAINS)[number];

export type RuntimeOwner = "browser" | "gascity" | "electron";

export const ELECTRON_CAPABILITIES = [
  "filesystem",
  "git",
  "native-dialog",
  "preview",
  "safe-storage",
  "terminal",
] as const;

export type ElectronCapability = (typeof ELECTRON_CAPABILITIES)[number];

const OWNERS: Record<IpcDomain, RuntimeOwner> = {
  account: "gascity",
  agent: "gascity",
  app: "gascity",
  appBlueprint: "gascity",
  appCollection: "electron",
  audio: "electron",
  capacitor: "electron",
  chat: "gascity",
  clerk: "browser",
  cloudflare: "electron",
  connectionFlow: "electron",
  context: "electron",
  coolify: "electron",
  coolifySetup: "electron",
  distributedMachines: "electron",
  factory: "gascity",
  factoryHost: "gascity",
  firstPrompt: "gascity",
  freeAgentQuota: "gascity",
  freeModelQuota: "gascity",
  git: "electron",
  github: "electron",
  help: "gascity",
  imageGeneration: "electron",
  import: "electron",
  knowledge: "electron",
  languageModel: "gascity",
  mcp: "electron",
  media: "electron",
  migration: "electron",
  misc: "electron",
  neon: "electron",
  plan: "gascity",
  previewView: "electron",
  prompt: "gascity",
  proposal: "gascity",
  recording: "electron",
  security: "electron",
  settings: "electron",
  supabase: "electron",
  system: "electron",
  template: "electron",
  terminal: "electron",
  tests: "electron",
  upgrade: "electron",
  userInput: "electron",
  vercel: "electron",
  version: "electron",
  visualEditing: "electron",
  windowInfrastructure: "electron",
};

const CAPABILITY_BY_DOMAIN: Partial<Record<IpcDomain, ElectronCapability>> = {
  appCollection: "filesystem",
  audio: "filesystem",
  context: "filesystem",
  git: "git",
  github: "git",
  imageGeneration: "filesystem",
  import: "filesystem",
  knowledge: "filesystem",
  media: "filesystem",
  previewView: "preview",
  recording: "filesystem",
  settings: "safe-storage",
  template: "filesystem",
  terminal: "terminal",
  tests: "terminal",
  userInput: "native-dialog",
  windowInfrastructure: "preview",
};

export function runtimeOwner(domain: IpcDomain): RuntimeOwner {
  return OWNERS[domain];
}

export function electronCapabilityFor(
  domain: IpcDomain,
): ElectronCapability | null {
  return CAPABILITY_BY_DOMAIN[domain] ?? null;
}

export function isElectronCapability(
  value: unknown,
): value is ElectronCapability {
  return (
    typeof value === "string" &&
    (ELECTRON_CAPABILITIES as readonly string[]).includes(value)
  );
}

export function domainsFor(owner: RuntimeOwner): IpcDomain[] {
  return IPC_DOMAINS.filter((domain) => OWNERS[domain] === owner);
}
