import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { PAGES } from "./helpers";

test("AC-16 full-page screenshots of the five pages", async ({ page }) => {
  const dir = join(process.env.EVIDENCE_DIR ?? "evidence", "screenshots");
  mkdirSync(dir, { recursive: true });
  const saved: string[] = [];
  for (const path of PAGES) {
    await page.goto(path);
    const name =
      path === "/" ? "home" : path.replace(/^\//, "").replace(/\//g, "-");
    const file = join(dir, `${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    await test
      .info()
      .attach(`${name}.png`, { path: file, contentType: "image/png" });
    saved.push(file);
  }
  test.info().annotations.push({
    type: "actual",
    description: `${saved.length} screenshots`,
  });
  expect(saved).toHaveLength(PAGES.length);
});
