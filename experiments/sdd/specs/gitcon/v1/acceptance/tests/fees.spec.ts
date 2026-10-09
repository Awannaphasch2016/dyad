import { test, expect } from "@playwright/test";
import { fees, squash } from "./helpers";

test("AC-08 fee page renders both tables cell for cell", async ({ page }) => {
  await page.goto("/registration-fee");
  await expect(page.locator("h1")).toHaveText(/^\s*Registration Fee\s*$/);
  const tables = page.locator("main table");
  await expect(tables).toHaveCount(fees.tables.length);
  const headings = (await page.locator("h2").allInnerTexts()).map(squash);
  const missing: string[] = [];
  for (const [i, table] of fees.tables.entries()) {
    if (!headings.includes(squash(table.title)))
      missing.push(`heading "${table.title}"`);
    const headerCells = (
      await tables.nth(i).locator("thead th, tr:first-child th").allInnerTexts()
    ).map(squash);
    for (const column of fees.columns) {
      if (!headerCells.includes(squash(column)))
        missing.push(`column "${column}" in table ${i + 1}`);
    }
    const rows = tables.nth(i).locator("tbody tr");
    expect(await rows.count(), `rows in table ${i + 1}`).toBe(
      table.rows.length,
    );
    for (const [j, row] of table.rows.entries()) {
      const cells = (await rows.nth(j).locator("td, th").allInnerTexts()).map(
        squash,
      );
      for (const cell of row)
        if (!cells.includes(squash(cell)))
          missing.push(`"${cell}" in table ${i + 1} row ${j + 1}`);
    }
  }
  test.info().annotations.push({
    type: "actual",
    description: missing.length
      ? `missing: ${missing.join("; ")}`
      : "all cells present",
  });
  expect(missing).toEqual([]);
  const text = squash(await page.locator("main").innerText());
  for (const sample of ["USD 150", "USD 425", "14,900 Baht"])
    expect(text).toContain(sample);
  expect(text).toContain(
    "All fees include conference materials, lunches and coffee breaks on both days.",
  );
});
