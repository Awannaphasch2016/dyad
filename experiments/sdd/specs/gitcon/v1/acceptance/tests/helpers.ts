import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";

const fixtures = join(import.meta.dirname, "..", "..", "fixtures");

export type Session = {
  time: string;
  title: string;
  speaker: string;
  affiliation: string;
  room: string;
};
export type Program = {
  days: { id: string; title: string; sessions: Session[] }[];
};
export type Fees = {
  columns: string[];
  tables: { title: string; rows: string[][] }[];
};

export const program: Program = JSON.parse(
  readFileSync(join(fixtures, "program.json"), "utf8"),
);
export const fees: Fees = JSON.parse(
  readFileSync(join(fixtures, "fees.json"), "utf8"),
);

export const PAGES = [
  "/",
  "/program",
  "/registration-fee",
  "/contact",
  "/no-such-page",
] as const;

export const NAV = [
  { text: "Home", href: "/" },
  { text: "Program", href: "/program" },
  { text: "Registration Fee", href: "/registration-fee" },
  { text: "Contact", href: "/contact" },
];

export const squash = (s: string) => s.replace(/\s+/g, " ").trim();

export async function bodyText(page: Page) {
  return squash(await page.locator("body").innerText());
}

export function pathOf(href: string | null) {
  if (!href) return "";
  try {
    return new URL(href, "http://x").pathname.replace(/\/+$/, "") || "/";
  } catch {
    return href;
  }
}

export const validMessage = {
  group: "Registration",
  subject: "Invoice for two student tickets",
  message: "Could you send one invoice covering both registrations?",
  name: "Arisa Tester",
  email: "arisa@example.org",
  phone: "+66 2 123 4567",
};
