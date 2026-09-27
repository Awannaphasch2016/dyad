import {
  type FactoryPhase,
  type FactoryPhaseShade,
  factoryPhaseLabel,
} from "./factoryPhase";

export interface FactoryDocumentSource {
  phase: FactoryPhase;
  discoverySummary: string | null;
  implementationSummary: string | null;
  deliverySummary: string | null;
  files: readonly string[];
  githubOrg: string | null;
  githubRepo: string | null;
  githubBranch: string | null;
  generatedOn: string;
}

export interface FactoryDocument {
  filename: string;
  html: string;
}

interface Requirement {
  id: string;
  text: string;
}

/** A phase can be downloaded once its stage is finished. */
export function canDownloadFactoryDocument(shade: FactoryPhaseShade): boolean {
  return shade === "finished";
}

export function summaryField(
  summary: string | null,
  label: string,
): string | null {
  if (!summary) return null;
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(
    `^\\s*[-*]\\s+\\*\\*${escaped}:\\*\\*\\s*(.+)$`,
    "im",
  ).exec(summary);
  return match?.[1]?.trim() || null;
}

export function pageSections(contents: string | null): string[] {
  if (!contents?.trim()) return [];
  const parts = contents
    .split(/[,;]\s*/)
    .map((part) => part.replace(/\.\s*$/, "").trim())
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts : [contents.trim()];
}

export function buildFactoryDocument(
  source: FactoryDocumentSource,
): FactoryDocument {
  const discovery = readDiscovery(source.discoverySummary);
  const title = documentTitle(source.phase);
  const status = source.phase === "delivery" ? "Released" : "Approved";
  const body =
    source.phase === "discovery"
      ? discoveryBody(discovery)
      : source.phase === "implementation"
        ? implementationBody(source, discovery)
        : deliveryBody(source, discovery);
  const html = renderDocument({
    title,
    phase: source.phase,
    siteName: discovery.pageName,
    status,
    generatedOn: source.generatedOn,
    body,
  });
  return {
    filename: `${slug(discovery.pageName)}-${filenameSuffix(source.phase)}.html`,
    html,
  };
}

export function downloadFactoryDocument(documentFile: FactoryDocument): void {
  const blob = new Blob([documentFile.html], {
    type: "text/html;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = documentFile.filename;
  link.click();
  URL.revokeObjectURL(url);
}

function readDiscovery(summary: string | null): {
  pageName: string;
  oneSentence: string;
  sections: string[];
  requirements: Requirement[];
} {
  const pageName = summaryField(summary, "Page name") ?? "Untitled page";
  const oneSentence =
    summaryField(summary, "One sentence") ?? "Not recorded in Discovery.";
  const sections = pageSections(summaryField(summary, "Page contents"));
  const source =
    sections.length > 0 ? sections : ["The page described in Discovery"];
  return {
    pageName,
    oneSentence,
    sections: source,
    requirements: source.map((text, index) => ({
      id: `REQ-${String(index + 1).padStart(3, "0")}`,
      text,
    })),
  };
}

function documentTitle(phase: FactoryPhase): string {
  if (phase === "discovery") return "Discovery specification";
  if (phase === "implementation") return "Implementation and test";
  return "Delivery";
}

function filenameSuffix(phase: FactoryPhase): string {
  if (phase === "discovery") return "discovery-specification";
  if (phase === "implementation") return "implementation-and-test";
  return "delivery";
}

function discoveryBody(discovery: ReturnType<typeof readDiscovery>): string {
  const outside = outsideSystem(discovery.sections);
  const zoom = zoomSection(discovery);
  return [
    h2("Purpose and scope"),
    p(
      `${escapeHtml(discovery.pageName)} is one page. ${escapeHtml(discovery.oneSentence)} Anything not listed in the requirements is out of scope.`,
    ),
    h2("Page identity"),
    table([
      ["Page name", discovery.pageName],
      ["One sentence", discovery.oneSentence],
      ["Audience", "The visitor the page is written for"],
    ]),
    h2("Requirements"),
    requirementTable(discovery.requirements),
    h2("C4 Context"),
    p("Who uses the page, and which outside systems it talks to."),
    contextDiagram(discovery.pageName, outside),
    h2("C4 Container"),
    p("The deployable pieces of the page."),
    containerDiagram(discovery.pageName, outside),
    h2("C4 Component"),
    p("The sections inside the page."),
    componentDiagram(discovery.requirements),
    h2("C4 Class"),
    p(
      `The types inside ${escapeHtml(zoom.text)}. The rest of the page is not repeated here.`,
    ),
    classZoomDiagram(zoom),
    h2("Wireframe"),
    p("The page, top to bottom, with no visual design."),
    wireframeDiagram(discovery.requirements),
    h2("Use case diagram"),
    p("Who does what. Each use case is one requirement."),
    useCaseDiagram(discovery.requirements),
    h2("Sequence diagram"),
    p("The order of one main visit."),
    sequenceDiagram(discovery.pageName, discovery.requirements, outside),
    h2("Class diagram"),
    p("The content model for the whole page."),
    domainClassDiagram(outside != null),
    h2("Constraints"),
    p(
      "One page only. No extra pages, accounts, or backends beyond an outside system named in the requirements.",
    ),
    h2("Acceptance"),
    p(
      "Implementation may start when the page name, the one sentence, and every requirement above still look right.",
    ),
  ].join("\n");
}

function implementationBody(
  source: FactoryDocumentSource,
  discovery: ReturnType<typeof readDiscovery>,
): string {
  const built = summaryField(source.implementationSummary, "Sections");
  const page = summaryField(source.implementationSummary, "Page");
  const changes = summaryField(
    source.implementationSummary,
    "Changes this turn",
  );
  const files = source.files.slice(0, 40);
  const unconfirmed = discovery.requirements.filter(
    (requirement) =>
      built == null ||
      !built.toLowerCase().includes(requirement.text.toLowerCase()),
  );
  return [
    h2("What was built"),
    p(page ? `Page: ${escapeHtml(page)}` : "The page file was not recorded."),
    p(
      built
        ? `Sections: ${escapeHtml(built)}`
        : "The implementation summary did not list the sections.",
    ),
    p(
      changes
        ? `Last change: ${escapeHtml(changes)}`
        : "No change note was recorded.",
    ),
    requirementTable(discovery.requirements),
    h2("Site contents"),
    files.length > 0
      ? `<ul>${files.map((file) => `<li><code>${escapeHtml(file)}</code></li>`).join("")}</ul>`
      : p("No app files were available when this document was written."),
    h2("What was tested"),
    p(
      "No automated test record is attached to this phase. The checks below are the requirements the built page is expected to satisfy. They were not run as a recorded test.",
    ),
    `<table><thead><tr><th>Requirement</th><th>Check</th><th>Result</th></tr></thead><tbody>${discovery.requirements
      .map(
        (requirement) =>
          `<tr><td>${escapeHtml(requirement.id)}</td><td>${escapeHtml(requirement.text)} is on the page</td><td>Not recorded</td></tr>`,
      )
      .join("")}</tbody></table>`,
    h2("Not tested"),
    p(discovery.requirements.map((requirement) => requirement.id).join(", ")),
    h2("Gaps"),
    unconfirmed.length === 0
      ? p("Every Discovery requirement is named in the implementation summary.")
      : p(
          `Not confirmed in the implementation summary: ${escapeHtml(unconfirmed.map((requirement) => `${requirement.id} ${requirement.text}`).join("; "))}.`,
        ),
  ].join("\n");
}

function deliveryBody(
  source: FactoryDocumentSource,
  discovery: ReturnType<typeof readDiscovery>,
): string {
  const shows =
    summaryField(source.deliverySummary, "What it shows") ??
    discovery.sections.join(", ");
  const view = summaryField(source.deliverySummary, "How to view it");
  const connected = source.githubOrg && source.githubRepo;
  const repoUrl = connected
    ? `https://github.com/${source.githubOrg}/${source.githubRepo}`
    : null;
  const branch = source.githubBranch || "main";
  return [
    h2("What you are receiving"),
    p(
      `${escapeHtml(discovery.pageName)}. ${escapeHtml(shows)}. This package also contains the Discovery specification and the Implementation and test document.`,
    ),
    h2("GitHub"),
    connected
      ? [
          p(`Repository: ${escapeHtml(repoUrl ?? "")}`),
          p(`Branch: ${escapeHtml(branch)}`),
          p("Clone:"),
          pre(
            `git clone ${repoUrl}.git\ncd ${source.githubRepo}\n${branch === "main" ? "" : `git checkout ${branch}\n`}`.trim(),
          ),
        ].join("\n")
      : p(
          "The repository is not connected yet. Connect GitHub, then download this document again for the clone command.",
        ),
    h2("Run it locally"),
    p(
      view
        ? escapeHtml(view)
        : "Install the project's dependencies, then start the page with its start command and open the preview.",
    ),
    h2("Deploy it yourself"),
    p(
      "Build the page with the project's install and start commands, then copy the built files to your server. Point the domain's DNS at that server. wewebplus does not choose the host.",
    ),
    h2("What was not done"),
    p("wewebplus did not deploy the site to a server."),
  ].join("\n");
}

function outsideSystem(sections: string[]): string | null {
  const text = sections.join(" ").toLowerCase();
  if (/\b(form|email|e-mail)\b/.test(text)) return "Message destination";
  if (/\b(map|payment|booking)\b/.test(text)) return "Outside service";
  return null;
}

function zoomSection(discovery: ReturnType<typeof readDiscovery>): Requirement {
  const match = discovery.requirements.find((requirement) =>
    /\b(form|email|e-mail|contact)\b/i.test(requirement.text),
  );
  return match ?? discovery.requirements[0];
}

function contextDiagram(pageName: string, outside: string | null): string {
  const height = outside ? 230 : 140;
  return svg(
    720,
    height,
    [
      arrowMarker(),
      box(20, 36, 160, 64, "Visitor", "reads the page"),
      box(270, 36, 180, 64, pageName, "one-page site"),
      box(520, 36, 160, 64, "Owner", "the page is for them"),
      arrow(180, 68, 270, 68, "reads"),
      outside
        ? [
            box(270, 140, 180, 64, outside, "named in Discovery"),
            arrow(360, 100, 360, 140, "sends"),
          ].join("")
        : "",
    ].join(""),
  );
}

function containerDiagram(pageName: string, outside: string | null): string {
  return svg(
    640,
    outside ? 220 : 140,
    [
      arrowMarker(),
      box(20, 36, 140, 56, "Visitor"),
      box(230, 36, 200, 56, "Page", pageName),
      arrow(160, 64, 230, 64, "opens"),
      outside
        ? [
            box(230, 140, 200, 56, "Form handler", outside),
            arrow(330, 92, 330, 140, "submits"),
          ].join("")
        : "",
    ].join(""),
  );
}

function componentDiagram(requirements: Requirement[]): string {
  const rows = Math.ceil(requirements.length / 2);
  const height = 24 + rows * 78;
  const boxes = requirements
    .map((requirement, index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      return box(
        20 + column * 300,
        16 + row * 78,
        270,
        64,
        requirement.text,
        requirement.id,
      );
    })
    .join("");
  return svg(620, height, boxes);
}

function classZoomDiagram(requirement: Requirement): string {
  const fields = /\b(form|email|e-mail|contact)\b/i.test(requirement.text)
    ? ["heading", "body", "fields", "where it is sent"]
    : ["heading", "body", "requirement id"];
  return svg(420, 150, classBox(20, 16, 280, requirement.text, fields));
}

function wireframeDiagram(requirements: Requirement[]): string {
  const height = 20 + requirements.length * 72;
  const blocks = requirements
    .map((requirement, index) =>
      box(40, 12 + index * 72, 360, 60, requirement.text, requirement.id),
    )
    .join("");
  return svg(440, height, blocks);
}

function useCaseDiagram(requirements: Requirement[]): string {
  const height = 40 + requirements.length * 48;
  const cases = requirements
    .map(
      (requirement, index) =>
        `<ellipse cx="300" cy="${36 + index * 48}" rx="120" ry="18" fill="#fff" stroke="#111"/><text x="300" y="${40 + index * 48}" text-anchor="middle" font-size="12">${escapeHtml(requirement.id)} ${escapeHtml(short(requirement.text, 22))}</text>`,
    )
    .join("");
  return svg(
    520,
    height,
    `<circle cx="70" cy="28" r="14" fill="none" stroke="#111"/><line x1="70" y1="42" x2="70" y2="78" stroke="#111"/><text x="70" y="96" text-anchor="middle" font-size="12">Visitor</text>${cases}`,
  );
}

function sequenceDiagram(
  pageName: string,
  requirements: Requirement[],
  outside: string | null,
): string {
  const steps = [
    "Open the page",
    ...requirements.map((requirement) => `Show ${requirement.text}`),
    outside ? `Send to ${outside}` : "Stay on the page",
  ];
  const height = 70 + steps.length * 36;
  const messages = steps
    .map((step, index) => {
      const y = 70 + index * 36;
      const fromVisitor = index % 2 === 0;
      return `<line x1="${fromVisitor ? 80 : 250}" y1="${y}" x2="${fromVisitor ? 250 : 80}" y2="${y}" stroke="#111" marker-end="url(#arrow)"/><text x="165" y="${y - 6}" text-anchor="middle" font-size="11">${escapeHtml(short(step, 32))}</text>`;
    })
    .join("");
  return svg(
    420,
    height,
    `${arrowMarker()}<text x="80" y="20" text-anchor="middle" font-size="12">Visitor</text><text x="250" y="20" text-anchor="middle" font-size="12">${escapeHtml(short(pageName, 18))}</text><line x1="80" y1="28" x2="80" y2="${height - 12}" stroke="#111"/><line x1="250" y1="28" x2="250" y2="${height - 12}" stroke="#111"/>${messages}`,
  );
}

function domainClassDiagram(hasSubmission: boolean): string {
  const page = classBox(20, 16, 200, "Page", [
    "name",
    "one sentence",
    "audience",
  ]);
  const section = classBox(250, 16, 200, "Section", [
    "order",
    "heading",
    "body",
    "requirement id",
  ]);
  const action = classBox(250, 180, 200, "Action", ["label", "where it goes"]);
  const submission = hasSubmission
    ? classBox(20, 180, 200, "Submission", ["fields", "where it is sent"])
    : "";
  return svg(
    480,
    hasSubmission ? 340 : 300,
    `${page}${section}${action}${submission}<text x="230" y="70" font-size="11">has</text>`,
  );
}

function renderDocument({
  title,
  phase,
  siteName,
  status,
  generatedOn,
  body,
}: {
  title: string;
  phase: FactoryPhase;
  siteName: string;
  status: string;
  generatedOn: string;
  body: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(siteName)} — ${escapeHtml(title)}</title>
<style>
  body { font-family: Georgia, serif; color: #111; max-width: 800px; margin: 32px auto; padding: 0 20px; line-height: 1.45; }
  h1 { font-size: 28px; margin-bottom: 8px; }
  h2 { font-size: 18px; margin-top: 28px; border-bottom: 1px solid #ccc; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0 16px; }
  th, td { border: 1px solid #ccc; text-align: left; padding: 6px 8px; vertical-align: top; }
  th { width: 180px; background: #f6f6f6; }
  svg { max-width: 100%; height: auto; margin: 8px 0 16px; }
  code, pre { font-family: ui-monospace, monospace; font-size: 13px; }
  pre { background: #f6f6f6; padding: 12px; white-space: pre-wrap; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<h2>Document control</h2>
<table>
<tr><th>Site</th><td>${escapeHtml(siteName)}</td></tr>
<tr><th>Document</th><td>${escapeHtml(title)}</td></tr>
<tr><th>Date</th><td>${escapeHtml(generatedOn)}</td></tr>
<tr><th>Version</th><td>1</td></tr>
<tr><th>Status</th><td>${escapeHtml(status)}</td></tr>
<tr><th>Phase</th><td>${escapeHtml(factoryPhaseLabel(phase))}</td></tr>
</table>
${body}
</body>
</html>`;
}

function requirementTable(requirements: Requirement[]): string {
  return `<table><thead><tr><th>Id</th><th>The page must show</th></tr></thead><tbody>${requirements
    .map(
      (requirement) =>
        `<tr><td>${escapeHtml(requirement.id)}</td><td>${escapeHtml(requirement.text)}</td></tr>`,
    )
    .join("")}</tbody></table>`;
}

function h2(text: string): string {
  return `<h2>${escapeHtml(text)}</h2>`;
}

function p(text: string): string {
  return `<p>${text}</p>`;
}

function pre(text: string): string {
  return `<pre>${escapeHtml(text)}</pre>`;
}

function table(rows: [string, string][]): string {
  return `<table>${rows
    .map(
      ([label, value]) =>
        `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`,
    )
    .join("")}</table>`;
}

function svg(width: number, height: number, inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img">${inner}</svg>`;
}

function arrowMarker(): string {
  return `<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#111"/></marker></defs>`;
}

function box(
  x: number,
  y: number,
  width: number,
  height: number,
  title: string,
  subtitle?: string,
): string {
  const labelY = subtitle ? y + 26 : y + height / 2 + 4;
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="6" fill="#fff" stroke="#111"/><text x="${x + width / 2}" y="${labelY}" text-anchor="middle" font-size="13">${escapeHtml(short(title, 28))}</text>${
    subtitle
      ? `<text x="${x + width / 2}" y="${y + 46}" text-anchor="middle" font-size="11" fill="#444">${escapeHtml(short(subtitle, 32))}</text>`
      : ""
  }`;
}

function classBox(
  x: number,
  y: number,
  width: number,
  name: string,
  fields: string[],
): string {
  const height = 36 + fields.length * 18;
  const rows = fields
    .map(
      (field, index) =>
        `<text x="${x + 12}" y="${y + 52 + index * 18}" font-size="12">${escapeHtml(field)}</text>`,
    )
    .join("");
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#fff" stroke="#111"/><text x="${x + width / 2}" y="${y + 22}" text-anchor="middle" font-size="13">${escapeHtml(short(name, 24))}</text><line x1="${x}" y1="${y + 32}" x2="${x + width}" y2="${y + 32}" stroke="#111"/>${rows}`;
}

function arrow(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  label: string,
): string {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#111" marker-end="url(#arrow)"/><text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 6}" text-anchor="middle" font-size="11">${escapeHtml(label)}</text>`;
}

function short(value: string, max: number): string {
  const clean = value.trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

function slug(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || "site";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
