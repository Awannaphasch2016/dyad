import assert from "node:assert/strict";
import test from "node:test";
import { originsWith } from "./clerk-origins.mjs";

test("a new preview origin is appended to the existing Clerk list", () => {
  const existing = [
    "https://pr-20.anakwannaphaschaiyong.com",
    "https://dyad-seven-pied.vercel.app",
  ];
  const next = originsWith(existing, "https://pr-26.anakwannaphaschaiyong.com");
  assert.equal(next.added, true);
  assert.deepEqual(next.origins, [
    "https://pr-20.anakwannaphaschaiyong.com",
    "https://dyad-seven-pied.vercel.app",
    "https://pr-26.anakwannaphaschaiyong.com",
  ]);
});

test("an origin that is already allowed is left unchanged", () => {
  const existing = ["https://pr-20.anakwannaphaschaiyong.com"];
  const next = originsWith(existing, "https://pr-20.anakwannaphaschaiyong.com");
  assert.equal(next.added, false);
  assert.deepEqual(next.origins, existing);
});

test("a non-preview origin is refused", () => {
  assert.throws(() => originsWith([], "https://example.com"), /pr-<number>/);
});
