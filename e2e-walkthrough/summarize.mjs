// Turn report/*.json into one Markdown table for the job summary. Reports hold
// ids, emails of the test accounts, phases, and verdicts. No secrets.

import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function readReports(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json") && name !== "playwright.json")
    .sort()
    .map((name) => ({
      name: name.replace(/\.json$/, ""),
      data: JSON.parse(readFileSync(join(directory, name), "utf8")),
    }));
}

function playwrightTotals(directory) {
  const file = join(directory, "playwright.json");
  if (!existsSync(file)) return null;
  const report = JSON.parse(readFileSync(file, "utf8"));
  const stats = report.stats ?? {};
  return {
    expected: Number(stats.expected ?? 0),
    unexpected: Number(stats.unexpected ?? 0),
    skipped: Number(stats.skipped ?? 0),
    flaky: Number(stats.flaky ?? 0),
  };
}

export function renderSummary(reports, totals) {
  const lines = ["## Walkthrough sign-in check", ""];
  if (totals) {
    lines.push(
      `Playwright: ${totals.expected} passed, ${totals.unexpected} failed, ${totals.skipped} skipped, ${totals.flaky} flaky`,
      "",
    );
  }
  lines.push("| Report | Result |", "| --- | --- |");
  for (const { name, data } of reports) {
    const summary =
      name === "password-strategy"
        ? data.verdict
        : `${data.role} · ${data.email} · ${data.strategy} · human step: ${data.humanStep} · ${data.secondsToSignIn}s · roleId=${data.roleId} · phase=${data.phase} · reload keeps session: ${data.reloadKeepsSession} · signed-out status ${data.signedOutStatus}`;
    lines.push(`| ${name} | ${String(summary).replace(/\|/g, "\\|")} |`);
  }
  if (reports.length === 0)
    lines.push("| none | no report files were written |");
  return `${lines.join("\n")}\n`;
}

const reports = readReports("report");
const text = renderSummary(reports, playwrightTotals("report"));
console.log(text);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
}
