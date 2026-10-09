import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { program, squash } from "./helpers";

test("AC-06 program has a heading per day in fixture order", async ({
  page,
}) => {
  await page.goto("/program");
  await expect(page.locator("h1")).toHaveText(/^\s*Program\s*$/);
  const headings = (await page.locator("h2").allInnerTexts()).map(squash);
  test
    .info()
    .annotations.push({ type: "actual", description: headings.join(" | ") });
  const dayTitles = program.days.map((d) => d.title);
  const found = headings.filter((h) => dayTitles.includes(h));
  expect(found).toEqual(dayTitles);
});

test("AC-07 every fixture session is rendered with time, title and speaker", async ({
  page,
}) => {
  await page.goto("/program");
  const tables = page.locator("main table");
  await expect(tables).toHaveCount(program.days.length);
  const mismatches: string[] = [];
  for (const [i, day] of program.days.entries()) {
    const rows = tables.nth(i).locator("tbody tr");
    const count = await rows.count();
    if (count !== day.sessions.length)
      mismatches.push(
        `${day.id}: ${count} rows, fixture has ${day.sessions.length}`,
      );
    for (const [j, session] of day.sessions.entries()) {
      if (j >= count) break;
      const cells = (await rows.nth(j).locator("td").allInnerTexts()).map(
        squash,
      );
      for (const field of ["time", "title", "speaker"] as const) {
        if (!cells.includes(squash(session[field])))
          mismatches.push(
            `${day.id} row ${j + 1}: ${field} "${session[field]}" not in [${cells.join(" / ")}]`,
          );
      }
    }
  }
  test.info().annotations.push({
    type: "actual",
    description: mismatches.length
      ? mismatches.slice(0, 10).join("; ")
      : "all sessions present",
  });
  expect(mismatches).toEqual([]);
});

test("AC-19 program is read from data/program.json at request time", async ({
  page,
}) => {
  const container = process.env.CONTAINER_NAME;
  test.skip(!container, "not measurable: CONTAINER_NAME not set");
  const marker = `Fixture Edit ${Date.now()}`;
  const original = program.days[0].sessions[0].title;
  let path = "";
  try {
    path = execFileSync(
      "docker",
      [
        "exec",
        container!,
        "sh",
        "-c",
        "find / -path '*/data/program.json' -not -path '*/proc/*' 2>/dev/null | head -n1",
      ],
      { encoding: "utf8" },
    ).trim();
  } catch {
    path = "";
  }
  test.skip(
    !path,
    "not measurable: data/program.json not found in the container",
  );
  const sed = `sed -i 's|${original.replace(/[|&]/g, "\\$&")}|${marker}|' '${path}'`;
  try {
    execFileSync("docker", ["exec", container!, "sh", "-c", sed]);
    await page.goto("/program");
    const text = squash(await page.locator("main").innerText());
    test.info().annotations.push({
      type: "actual",
      description: text.includes(marker)
        ? "edited title rendered"
        : "edited title not rendered",
    });
    expect(text).toContain(marker);
  } finally {
    execFileSync("docker", [
      "exec",
      container!,
      "sh",
      "-c",
      `sed -i 's|${marker}|${original.replace(/[|&]/g, "\\$&")}|' '${path}'`,
    ]);
  }
});
