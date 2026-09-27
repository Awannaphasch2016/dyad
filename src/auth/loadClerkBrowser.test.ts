import { afterEach, describe, expect, it } from "vitest";
import { hideAmdDefine } from "./loadClerkBrowser";

describe("hideAmdDefine", () => {
  afterEach(() => {
    delete (window as { define?: unknown }).define;
  });

  it("removes Monaco's AMD define and puts it back", () => {
    const define = Object.assign(() => undefined, { amd: { jQuery: true } });
    (window as { define?: unknown }).define = define;
    const restore = hideAmdDefine();
    expect((window as { define?: unknown }).define).toBeUndefined();
    restore();
    expect((window as { define?: unknown }).define).toBe(define);
  });

  it("leaves a normal page alone", () => {
    const restore = hideAmdDefine();
    expect((window as { define?: unknown }).define).toBeUndefined();
    restore();
  });
});
