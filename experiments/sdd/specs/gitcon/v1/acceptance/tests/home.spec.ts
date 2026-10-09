import { test, expect } from "@playwright/test";
import { bodyText } from "./helpers";

test("AC-05 home shows the title, theme, dates and place", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(
    "Home - GIT 2025 Responsible Gem & Jewelry Supply Chain",
  );
  await expect(page.locator("h1")).toHaveText(/^\s*GIT 2025\s*$/);
  const text = await bodyText(page);
  expect(text).toContain("Responsible Gem & Jewelry Supply Chain");
  expect(text.replace(/\s*-\s*/g, "-")).toContain("8-9 September 2025");
  expect(text).toContain("Bangkok, Thailand");
  expect(text).toContain(
    "has proudly hosted the Gem and Jewelry Conferences since 2006",
  );
  expect(text).toContain("72nd Bangkok Gem and Jewelry Fair");
  const main = page.locator("main");
  await expect(
    main.getByRole("link", { name: "Registration Fee", exact: true }).first(),
  ).toBeVisible();
  await expect(
    main.getByRole("link", { name: "Program", exact: true }).first(),
  ).toBeVisible();
});
