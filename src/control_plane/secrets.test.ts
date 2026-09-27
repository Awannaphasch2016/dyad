import { afterEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./secrets";

describe("account connection secrets", () => {
  const previous = process.env.WEWEBPLUS_SECRETS_KEY;

  afterEach(() => {
    if (previous === undefined) delete process.env.WEWEBPLUS_SECRETS_KEY;
    else process.env.WEWEBPLUS_SECRETS_KEY = previous;
  });

  it("round-trips a token without storing it in plaintext", () => {
    process.env.WEWEBPLUS_SECRETS_KEY = "test-secret";
    const payload = encryptSecret("ghp_example");
    expect(payload).not.toContain("ghp_example");
    expect(decryptSecret(payload)).toBe("ghp_example");
  });
});
