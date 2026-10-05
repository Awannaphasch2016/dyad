import { BIN, COMMANDS } from "./constants.js";

export const TOP_LEVEL_HELP = `${BIN} — check and control Wewebplus previews.

Running ${BIN} with no arguments shows the public preview rows.
resume starts containers that are already built. It never builds an image.

Commands:
  status [--pr N]     Public URL, HTTP status, and browser bridge
  inspect --pr N      Digest, tunnel, Neon branch, Clerk origin, transport
  verify --pr N       Exit 0 only for HTTP 200 and the browser bridge
  logs --pr N         Last 2,000 characters. --full writes a temp file
  resume [--pr N]     Start one saved preview, or every saved preview
  deploy [--pr N]     Publish only when sha-<commit> is missing, then start
  destroy --pr N --yes  Remove that preview
  db status|ensure|assign --pr N
  env status          Secret names are present or absent
  run list|view       Preview workflow runs
  setup hooks         Opt-in session hook

${BIN} resume --pr 27
${BIN} verify --pr 27
`;

export const COMMAND_HELP = {
  status: `command: status
description: Public URL, HTTP status, and browser bridge
flags:
  --pr: Pull request number
  --repo: owner/name
  --fields: digest, tunnel, gc
`,
  inspect: `command: inspect
description: One preview, including digest, tunnel, Neon branch, and transport
flags:
  --pr: Pull request number
  --repo: owner/name
`,
  verify: `command: verify
description: Exit 0 only when the page is HTTP 200 and includes the browser bridge
flags:
  --pr: Pull request number
  --repo: owner/name
`,
  logs: `command: logs
description: Last 2,000 characters of the Dyad container log
flags:
  --pr: Pull request number
  --repo: owner/name
  --full: Write the log to a temp file
`,
  resume: `command: resume
description: Start containers that are already built. This never builds an image.
flags:
  --pr: Pull request number. Omit it to start every saved preview.
  --repo: owner/name
`,
  deploy: `command: deploy
description: Ask the Preview image workflow to publish a missing tag, then start the preview. The same live digest exits 0.
flags:
  --pr: Pull request number
  --repo: owner/name
`,
  destroy: `command: destroy
description: Remove one preview. Requires --pr and --yes. Refuses the production marker.
flags:
  --pr: Pull request number. An inferred pull request is refused.
  --yes: Confirm removal
  --repo: owner/name
`,
  db: `command: db
description: Neon branch preview-pr-N and the page database assignment
args: status, ensure, assign
flags:
  --pr: Pull request number
  --repo: owner/name
`,
  env: `command: env
description: Report whether preview secret names are present. Values are never printed.
args: status
`,
  run: `command: run
description: Preview image and preview control workflow runs
args: list, view <id>
flags:
  --repo: owner/name
`,
  setup: `command: setup
description: Install the session hook for Claude Code, Codex, and OpenCode
args: hooks
`,
};

export function skillDocument() {
  const lines = [
    "# wewebplus-preview",
    "",
    "Control Wewebplus previews on Wewebplus-ci.",
    "The binary is a container. Copy `packages/wewebplus-preview` into a future axi-awesome repository. That repository does not exist yet.",
    "",
    "resume starts containers that are already built. resume does not build an image.",
    "Without a git checkout the CLI dispatches Awannaphasch2016/dyad at cursor/formula-preview-9e7a. Override with --repo and --ref.",
    "destroy requires `--pr` and `--yes`.",
    "Secret values are never printed. Names are `present` or `absent`.",
    "",
    "## Commands",
    "",
  ];
  for (const name of COMMANDS) {
    lines.push(`- \`${BIN} ${name}\``);
  }
  lines.push(
    "",
    "## Already built",
    "",
    `- \`${BIN}\``,
    `- \`${BIN} resume --pr 27\``,
    `- \`${BIN} verify --pr 27\``,
    "",
    "A refused dispatch points at Re-run all jobs on the last successful Preview image run.",
    "",
  );
  return `${lines.join("\n")}\n`;
}
