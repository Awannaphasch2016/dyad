import { test, expect } from "@playwright/test";
import { NAV, pathOf } from "./helpers";

test("AC-14 unknown path returns 404 inside the shared layout", async ({
  page,
}) => {
  const response = await page.goto("/no-such-page");
  expect(response?.status()).toBe(404);
  await expect(page.locator("h1")).toHaveText(/^\s*Page not found\s*$/);
  const nav = page.locator("header nav").first();
  for (const item of NAV)
    await expect(
      nav.getByRole("link", { name: item.text, exact: true }).first(),
    ).toHaveCount(1);
  const back = page
    .locator("main")
    .getByRole("link", { name: "Back to Home", exact: true })
    .first();
  await expect(back).toBeVisible();
  expect(pathOf(await back.getAttribute("href"))).toBe("/");
});
