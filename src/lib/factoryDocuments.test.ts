import { describe, expect, it } from "vitest";
import {
  buildFactoryDocument,
  canDownloadFactoryDocument,
  pageSections,
  summaryField,
} from "./factoryDocuments";

const discovery = [
  "- **Page name:** Tiny Bakery",
  "- **One sentence:** A neighborhood bakery's opening hours and menu.",
  "- **Page contents:** Hero, menu of 3 breads, hours, contact form.",
].join("\n");

const source = {
  discoverySummary: discovery,
  implementationSummary: [
    "- **Page:** index.html",
    "- **Sections:** Hero, menu of 3 breads, hours, contact form",
    "- **Changes this turn:** Built the page.",
  ].join("\n"),
  deliverySummary: [
    "- **Page name:** Tiny Bakery",
    "- **What it shows:** Hero, menu, hours, and a contact form",
    "- **How to view it:** Open index.html",
  ].join("\n"),
  files: ["index.html", "styles.css"],
  githubOrg: "bakery",
  githubRepo: "tiny-bakery",
  githubBranch: "main",
  generatedOn: "2026-09-25",
};

describe("factory documents", () => {
  it("reads the discovery fields and splits the page into sections", () => {
    expect(summaryField(discovery, "Page name")).toBe("Tiny Bakery");
    expect(pageSections(summaryField(discovery, "Page contents"))).toEqual([
      "Hero",
      "menu of 3 breads",
      "hours",
      "contact form",
    ]);
  });

  it("offers a download only after the phase is finished", () => {
    expect(canDownloadFactoryDocument("finished")).toBe(true);
    expect(canDownloadFactoryDocument("in-progress")).toBe(false);
    expect(canDownloadFactoryDocument("not-started")).toBe(false);
  });

  it("writes the discovery specification with every diagram", () => {
    const document = buildFactoryDocument({ ...source, phase: "discovery" });
    expect(document.filename).toBe("tiny-bakery-discovery-specification.html");
    for (const heading of [
      "Discovery specification",
      "C4 Context",
      "C4 Container",
      "C4 Component",
      "C4 Class",
      "Wireframe",
      "Use case diagram",
      "Sequence diagram",
      "Class diagram",
      "REQ-001",
      "REQ-004",
      "Message destination",
      "Tiny Bakery",
    ]) {
      expect(document.html).toContain(heading);
    }
    expect(document.html).not.toContain("<script>");
  });

  it("escapes page text so the document cannot run it", () => {
    const document = buildFactoryDocument({
      ...source,
      phase: "discovery",
      discoverySummary:
        "- **Page name:** <script>alert(1)</script>\n- **One sentence:** Y\n- **Page contents:** Hero",
    });
    expect(document.html).toContain("&lt;script&gt;");
    expect(document.html).not.toContain("<script>");
  });

  it("puts what was built and what was tested in one implementation file", () => {
    const document = buildFactoryDocument({
      ...source,
      phase: "implementation",
    });
    expect(document.filename).toBe("tiny-bakery-implementation-and-test.html");
    expect(document.html).toContain("What was built");
    expect(document.html).toContain("What was tested");
    expect(document.html).toContain("Not recorded");
    expect(document.html).toContain("index.html");
    expect(document.html).toContain("REQ-001");
  });

  it("includes the clone command when GitHub is connected", () => {
    const document = buildFactoryDocument({ ...source, phase: "delivery" });
    expect(document.html).toContain(
      "git clone https://github.com/bakery/tiny-bakery.git",
    );
    expect(document.html).toContain(
      "wewebplus did not deploy the site to a server.",
    );
  });

  it("says the repository is not connected when GitHub is missing", () => {
    const document = buildFactoryDocument({
      ...source,
      phase: "delivery",
      githubOrg: null,
      githubRepo: null,
    });
    expect(document.html).toContain("The repository is not connected yet.");
  });
});
