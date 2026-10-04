import { describe, expect, it } from "vitest";
import { isProviderSetup } from "./providerUtils";
import type { UserSettings } from "./schemas";

const settings = {
  selectedModel: { provider: "auto", name: "auto" },
  providerSettings: {},
} as UserSettings;

describe("isProviderSetup bedrock", () => {
  it("treats the IAM flag as configured without a saved key", () => {
    expect(
      isProviderSetup("bedrock", {
        settings,
        envVars: { BEDROCK_IAM: "1" },
      }),
    ).toBe(true);
  });

  it("stays unconfigured when the IAM flag and saved key are absent", () => {
    expect(
      isProviderSetup("bedrock", {
        settings,
        envVars: {},
      }),
    ).toBe(false);
  });
});
