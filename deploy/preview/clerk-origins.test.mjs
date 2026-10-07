import assert from "node:assert/strict";
import test from "node:test";
import { canaryOrigin, originsWith } from "./clerk-origins.mjs";

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

test("a temporary tunnel origin is appended", () => {
  const next = originsWith(
    ["https://pr-20.anakwannaphaschaiyong.com"],
    "https://example-preview.trycloudflare.com",
  );
  assert.equal(next.added, true);
  assert.deepEqual(next.origins, [
    "https://pr-20.anakwannaphaschaiyong.com",
    "https://example-preview.trycloudflare.com",
  ]);
});

test("the canary hostname is appended", () => {
  const next = originsWith(
    ["https://pr-20.anakwannaphaschaiyong.com"],
    canaryOrigin,
  );
  assert.equal(next.added, true);
  assert.equal(next.origins.at(-1), canaryOrigin);
});

test("a non-preview origin is refused", () => {
  assert.throws(() => originsWith([], "https://example.com"), /pr-<number>/);
});
