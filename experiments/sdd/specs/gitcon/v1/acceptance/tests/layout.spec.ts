import { test, expect } from "@playwright/test";
import { PAGES, NAV, bodyText, pathOf } from "./helpers";

test("AC-02 every page answers without a server error", async ({ request }) => {
  const statuses: Record<string, number> = {};
  for (const path of PAGES) {
    const res = await request.get(path);
    statuses[path] = res.status();
  }
  test.info().annotations.push({
    type: "actual",
    description: JSON.stringify(statuses),
  });
  expect(statuses["/"]).toBe(200);
  for (const [path, status] of Object.entries(statuses)) {
    expect(status, `${path} returned ${status}`).toBeLessThan(500);
  }
});

test("AC-03 header shows the event name and the four navigation links", async ({
  page,
}) => {
  await page.goto("/");
  const header = page.locator("header").first();
  await expect(header).toBeVisible();
  const brand = header.getByRole("link", { name: /GIT 2025/ }).first();
  await expect(brand).toBeVisible();
  expect(pathOf(await brand.getAttribute("href"))).toBe("/");
  const nav = header.locator("nav").first();
  for (const item of NAV) {
    const link = nav
      .getByRole("link", { name: item.text, exact: true })
      .first();
    await expect(link, `nav link ${item.text}`).toHaveCount(1);
    expect(
      pathOf(await link.getAttribute("href")),
      `href of ${item.text}`,
    ).toBe(item.href);
  }
});

test("AC-04 footer carries organiser, email, phone and copyright", async ({
  page,
}) => {
  await page.goto("/");
  const footer = page.locator("footer").first();
  await expect(footer).toBeVisible();
  const text = (await footer.innerText()).replace(/\s+/g, " ");
  expect(text).toContain(
    "The Gem and Jewelry Institute of Thailand (Public Organization)",
  );
  expect(text).toContain("(+66) 2634 4999");
  expect(text).toContain("Copyright © 2025. All rights reserved.");
  const mail = footer.locator('a[href^="mailto:"]').first();
  await expect(mail).toHaveText(/gitconference@git\.or\.th/);
});

test("AC-15 navigation is reachable at 375 px without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await page.goto("/");
  const nav = page.locator("header nav").first();
  const links = nav.getByRole("link");
  const visibleBefore = await links.evaluateAll(
    (els) =>
      els.filter((el) => (el as HTMLElement).offsetParent !== null).length,
  );
  if (visibleBefore < NAV.length) {
    const toggle = page.locator("header button").first();
    await expect(
      toggle,
      "a single button should reveal the navigation",
    ).toBeVisible();
    await toggle.click();
  }
  for (const item of NAV) {
    await expect(
      nav.getByRole("link", { name: item.text, exact: true }).first(),
    ).toBeVisible();
  }
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow, "horizontal overflow in px").toBeLessThanOrEqual(1);
});

test("AC-18 each page has one h1, one main and unique ids", async ({
  page,
}) => {
  const problems: string[] = [];
  for (const path of PAGES) {
    await page.goto(path);
    const h1 = await page.locator("h1").count();
    const main = await page.locator("main").count();
    const dupes = await page.evaluate(() => {
      const seen = new Map<string, number>();
      for (const el of document.querySelectorAll("[id]"))
        seen.set(el.id, (seen.get(el.id) ?? 0) + 1);
      return [...seen].filter(([, n]) => n > 1).map(([id]) => id);
    });
    if (h1 !== 1) problems.push(`${path}: ${h1} h1 elements`);
    if (main !== 1) problems.push(`${path}: ${main} main elements`);
    if (dupes.length)
      problems.push(`${path}: duplicate ids ${dupes.join(", ")}`);
  }
  test.info().annotations.push({
    type: "actual",
    description: problems.length
      ? problems.join("; ")
      : "all pages well-formed",
  });
  expect(problems).toEqual([]);
  expect(await bodyText(page)).not.toBe("");
});
