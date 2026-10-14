import path from "node:path";
import { expect, test } from "vitest";
import config from "../../../vite.preload.config.mts";

test("preload bundle resolves @ to src for IPC contract imports", () => {
  expect(config.resolve?.alias).toMatchObject({
    "@": path.resolve(import.meta.dirname, "../../..", "src"),
  });
});
