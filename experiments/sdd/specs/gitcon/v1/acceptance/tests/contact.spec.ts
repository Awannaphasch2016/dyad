import { test, expect, type Page } from "@playwright/test";
import { validMessage, pathOf } from "./helpers";

const FIELDS = [
  "group",
  "subject",
  "message",
  "name",
  "email",
  "phone",
] as const;
const GROUPS = [
  "General",
  "Registration",
  "Abstract Submission",
  "Sponsorship",
];

async function fill(page: Page, values: Partial<typeof validMessage>) {
  const form = page
    .locator('form[action*="/contact"], form[method="post" i]')
    .first();
  if (values.group !== undefined)
    await form
      .locator('select[name="group"]')
      .selectOption({ label: values.group });
  for (const field of [
    "subject",
    "message",
    "name",
    "email",
    "phone",
  ] as const) {
    if (values[field] !== undefined)
      await form.locator(`[name="${field}"]`).fill(values[field]!);
  }
  return form;
}

async function submit(page: Page, form: ReturnType<Page["locator"]>) {
  await Promise.all([
    page.waitForLoadState("load"),
    form
      .locator(
        'button[type="submit"], input[type="submit"], button:not([type])',
      )
      .first()
      .click(),
  ]);
}

test("AC-09 contact form has the required controls", async ({ page }) => {
  await page.goto("/contact");
  await expect(page.locator("h1")).toHaveText(/^\s*Contact\s*$/);
  const form = page
    .locator('form[action*="/contact"], form[method="post" i]')
    .first();
  await expect(form).toBeVisible();
  expect(pathOf(await form.getAttribute("action"))).toBe("/contact");
  expect(((await form.getAttribute("method")) ?? "").toLowerCase()).toBe(
    "post",
  );
  for (const field of FIELDS)
    await expect(
      form.locator(`[name="${field}"]`),
      `control ${field}`,
    ).toHaveCount(1);
  const options = (
    await form.locator('select[name="group"] option').allInnerTexts()
  ).map((t) => t.trim());
  expect(options).toEqual(GROUPS);
  await expect(
    form
      .locator(
        'button[type="submit"], input[type="submit"], button:not([type])',
      )
      .first(),
  ).toBeVisible();
});

test("AC-10 empty submission shows errors and no confirmation", async ({
  page,
  request,
}) => {
  // Bypass HTML5 required attributes: post an empty body directly, then also
  // check the browser path with the attributes stripped.
  const direct = await request.post("/contact", {
    form: {
      group: "",
      subject: "",
      message: "",
      name: "",
      email: "",
      phone: "",
    },
  });
  expect(direct.status()).toBe(200);
  const html = await direct.text();
  // Match attributes on elements, not CSS selectors such as [data-error] in a <style> block.
  const errors = (html.match(/<[a-z][^>]*\sdata-error(=|\s|>)/gi) ?? []).length;
  const confirmed = /<[a-z][^>]*\sdata-confirmation(=|\s|>)/i.test(html);
  test.info().annotations.push({
    type: "actual",
    description: `${errors} data-error elements, confirmation ${confirmed ? "present" : "absent"}`,
  });
  expect(errors).toBeGreaterThanOrEqual(4);
  expect(confirmed).toBe(false);

  await page.goto("/contact");
  await page.evaluate(() =>
    document
      .querySelectorAll("[required]")
      .forEach((el) => el.removeAttribute("required")),
  );
  const form = await fill(page, {
    subject: "",
    message: "",
    name: "",
    email: "",
    phone: "",
  });
  await submit(page, form);
  expect(await page.locator("[data-error]").count()).toBeGreaterThanOrEqual(4);
  await expect(page.locator("[data-confirmation]")).toHaveCount(0);
});

test("AC-11 invalid email is rejected and other values are preserved", async ({
  page,
}) => {
  await page.goto("/contact");
  await page.evaluate(() =>
    document
      .querySelectorAll("[type=email]")
      .forEach((el) => el.setAttribute("type", "text")),
  );
  const form = await fill(page, { ...validMessage, email: "not-an-email" });
  await submit(page, form);
  await expect(page.locator('[data-error="email"]')).toHaveCount(1);
  await expect(page.locator("[data-confirmation]")).toHaveCount(0);
  const after = page.locator("form").first();
  await expect(after.locator('[name="subject"]')).toHaveValue(
    validMessage.subject,
  );
  await expect(after.locator('[name="message"]')).toHaveValue(
    validMessage.message,
  );
  await expect(after.locator('[name="name"]')).toHaveValue(validMessage.name);
  await expect(after.locator('[name="phone"]')).toHaveValue(validMessage.phone);
  await expect(after.locator('[name="email"]')).toHaveValue("not-an-email");
  await expect(after.locator('select[name="group"]')).toHaveValue(/.+/);
  const selected = await after
    .locator('select[name="group"] option:checked')
    .innerText();
  expect(selected.trim()).toBe(validMessage.group);
});

test("AC-12 valid submission is confirmed and listed in submissions.json", async ({
  page,
  request,
}) => {
  const subject = `${validMessage.subject} ${Date.now()}`;
  await page.goto("/contact");
  const form = await fill(page, { ...validMessage, subject });
  await submit(page, form);
  const confirmation = page.locator("[data-confirmation]");
  await expect(confirmation).toHaveCount(1);
  await expect(confirmation).toContainText(
    "Thank you, your message has been sent.",
  );
  await expect(confirmation).toContainText(subject);
  await expect(page.locator("h1")).toHaveText(/^\s*Contact\s*$/);
  const res = await request.get("/contact/submissions.json");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"] ?? "").toMatch(/application\/json/);
  const list = (await res.json()) as Record<string, string>[];
  const found = list.find((m) => m.subject === subject);
  test.info().annotations.push({
    type: "actual",
    description: `${list.length} stored, match ${found ? "found" : "missing"}`,
  });
  expect(found).toBeTruthy();
  expect(found!.email).toBe(validMessage.email);
  expect(found!.group).toBe(validMessage.group);
});

test("AC-13 second submission appends one record with the exact key set", async ({
  request,
}) => {
  const before = (
    (await (await request.get("/contact/submissions.json")).json()) as unknown[]
  ).length;
  const subject = `Second message ${Date.now()}`;
  const res = await request.post("/contact", {
    form: { ...validMessage, subject },
  });
  expect(res.status()).toBe(200);
  const list = (await (
    await request.get("/contact/submissions.json")
  ).json()) as Record<string, unknown>[];
  test.info().annotations.push({
    type: "actual",
    description: `before ${before}, after ${list.length}`,
  });
  expect(list.length).toBe(before + 1);
  const last = list[list.length - 1];
  expect(Object.keys(last).sort()).toEqual([...FIELDS, "submitted_at"].sort());
  expect(last.subject).toBe(subject);
  expect(String(last.submitted_at)).toMatch(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
  );
});
