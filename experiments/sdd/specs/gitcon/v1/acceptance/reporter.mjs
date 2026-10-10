#!/usr/bin/env node
// Merge the Playwright JSON report with the workflow's build and leak-scan
// evidence into results.partial.json: one entry per AC in criteria.md with
// status, expected (the criteria text), actual (test annotation or error) and
// evidence paths relative to the evidence directory.
// Usage: node reporter.mjs [evidenceDir]   (default: evidence)
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const evidenceDir = process.argv[2] ?? "evidence";

function readJson(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

export function parseCriteria(markdown) {
  const rows = [];
  for (const line of markdown.split(/\r?\n/)) {
    const m = line.match(
      /^\|\s*(AC-\d+)\s*\|\s*([^|]+)\|\s*([^|]*)\|\s*([^|]+)\|\s*([^|]+)\|/,
    );
    if (!m) continue;
    const fr =
      m[2].trim() === "all" ? ["all"] : m[2].split(",").map((s) => s.trim());
    rows.push({
      id: m[1],
      fr,
      section: m[3].trim(),
      expected: m[4].trim(),
      measuredBy: m[5].trim(),
    });
  }
  return rows;
}

function flattenSuites(suite, out = []) {
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests ?? []) {
      const result = t.results[t.results.length - 1] ?? {};
      out.push({
        title: spec.title,
        status: t.status,
        result,
        file: spec.file,
      });
    }
  }
  for (const child of suite.suites ?? []) flattenSuites(child, out);
  return out;
}

export function buildResults({
  criteria,
  playwright,
  build,
  leak,
  evidenceDir,
}) {
  const tests = playwright
    ? (playwright.suites ?? []).flatMap((s) => flattenSuites(s))
    : [];
  const byId = new Map();
  for (const t of tests) {
    const id = t.title.match(/^(AC-\d+)/)?.[1];
    if (id) byId.set(id, t);
  }
  const acceptance = criteria.map((row) => {
    const entry = {
      id: row.id,
      fr: row.fr,
      status: "not_run",
      expected: row.expected,
      actual: "",
      evidence: [],
    };
    if (row.measuredBy.startsWith("workflow")) {
      if (row.id === "AC-01") {
        if (build) {
          entry.status = build.docker_build === "ok" ? "passed" : "failed";
          entry.actual = `docker build ${build.docker_build}${build.build_seconds != null ? ` in ${build.build_seconds}s` : ""}`;
          entry.evidence.push("build.json", "docker-build.log");
        }
      } else if (row.id === "AC-17") {
        if (build && build.network_none_status != null) {
          entry.status =
            build.network_none_status === 200 ? "passed" : "failed";
          entry.actual = `GET / with --network none returned ${build.network_none_status}`;
          entry.evidence.push("build.json");
        } else if (build) {
          entry.status = "not_measurable";
          entry.actual = "network-none check did not run";
        }
      } else if (row.id === "AC-20") {
        if (leak) {
          entry.status = leak.hits.length === 0 ? "passed" : "failed";
          entry.actual =
            leak.hits.length === 0
              ? `no marker in ${leak.files_scanned} files`
              : `${leak.hits.length} hits: ${leak.hits
                  .slice(0, 5)
                  .map((h) => `${h.file}:${h.line} ${h.marker}`)
                  .join("; ")}`;
          entry.evidence.push("leak-scan.json");
        }
      }
      return entry;
    }
    const t = byId.get(row.id);
    if (!t) {
      entry.actual = playwright
        ? "no test with this id ran"
        : "playwright.json missing";
      return entry;
    }
    const r = t.result;
    const annotation = (r.annotations ?? t.annotations ?? []).find(
      (a) => a.type === "actual",
    )?.description;
    const skipReason = (r.annotations ?? []).find(
      (a) => a.type === "skip",
    )?.description;
    if (t.status === "skipped") {
      entry.status = "not_measurable";
      entry.actual = skipReason ?? "skipped";
    } else {
      entry.status = t.status === "expected" ? "passed" : "failed";
      entry.actual =
        annotation ??
        (r.error?.message
          ? r.error.message
              .replace(/\u001b\[[0-9;]*m/g, "")
              .split("\n")
              .slice(0, 6)
              .join(" ")
              .slice(0, 600)
          : t.status === "expected"
            ? "as expected"
            : t.status);
    }
    for (const a of r.attachments ?? []) {
      if (a.path)
        entry.evidence.push(relative(evidenceDir, a.path).replace(/\\/g, "/"));
    }
    return entry;
  });

  const measurable = acceptance.filter((a) => a.status !== "not_measurable");
  const passed = measurable.filter((a) => a.status === "passed").length;
  const frs = [
    ...new Set(criteria.flatMap((c) => c.fr).filter((f) => f !== "all")),
  ].sort();
  const implemented = frs.filter((fr) =>
    acceptance
      .filter((a) => a.fr.includes(fr) && a.status !== "not_measurable")
      .every((a) => a.status === "passed"),
  );
  const uiTests = acceptance.filter(
    (a) =>
      a.evidence.some((e) => e.endsWith(".png")) ||
      ["AC-15", "AC-16"].includes(a.id),
  );
  return {
    acceptance,
    spec_coverage: {
      implemented: implemented.length,
      total: frs.length,
      ratio: frs.length ? +(implemented.length / frs.length).toFixed(3) : 0,
      implemented_frs: implemented,
    },
    verification_pass_rate: {
      passed,
      total: measurable.length,
      ratio: measurable.length ? +(passed / measurable.length).toFixed(3) : 0,
      not_measurable: acceptance.length - measurable.length,
    },
    ui_verification: {
      pages_visited: 5,
      screenshots:
        acceptance
          .find((a) => a.id === "AC-16")
          ?.evidence.filter((e) => e.endsWith(".png")) ?? [],
      failures: uiTests
        .filter((a) => a.status === "failed")
        .map((a) => `${a.id}: ${a.actual}`),
    },
    build: build ?? {
      docker_build: "unknown",
      container_healthy: false,
      build_seconds: null,
    },
    playwright: playwright
      ? {
          duration_ms: playwright.stats?.duration ?? null,
          expected: playwright.stats?.expected ?? 0,
          unexpected: playwright.stats?.unexpected ?? 0,
          skipped: playwright.stats?.skipped ?? 0,
        }
      : null,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const criteria = parseCriteria(
    readFileSync(join(here, "criteria.md"), "utf8"),
  );
  const results = buildResults({
    criteria,
    playwright: readJson(join(evidenceDir, "playwright.json")),
    build: readJson(join(evidenceDir, "build.json")),
    leak: readJson(join(evidenceDir, "leak-scan.json")),
    evidenceDir,
  });
  const out = join(evidenceDir, "results.partial.json");
  writeFileSync(out, JSON.stringify(results, null, 2) + "\n");
  const { passed, total, not_measurable } = results.verification_pass_rate;
  console.log(
    `${out}: ${passed}/${total} passed, ${not_measurable} not measurable, coverage ${results.spec_coverage.implemented}/${results.spec_coverage.total}`,
  );
}
