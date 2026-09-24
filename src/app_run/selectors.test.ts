import { describe, expect, it } from "vitest";
import { projectAppRunRemoteSnapshot } from "./transport";
import type { AppRunInvocationRef, RunState } from "./state";
import {
  isAppRunLoading,
  selectRemoteAppExit,
  selectRemoteAppUrl,
} from "./selectors";

const invocationRef: AppRunInvocationRef = {
  kind: "app-run",
  entityKey: 7,
  operationId: "run-1",
};

function snapshot(state: RunState) {
  return projectAppRunRemoteSnapshot(7, 1, state);
}

describe("isAppRunLoading", () => {
  it("shows the page once the server is ready, even if start has not settled", () => {
    expect(
      isAppRunLoading({
        phase: "ready",
        admissionKind: "preparing",
        executionKind: "running",
      }),
    ).toBe(false);
    expect(
      isAppRunLoading({
        phase: "reloading",
        admissionKind: "idle",
        executionKind: "running",
      }),
    ).toBe(false);
  });

  it("keeps the spinner while the server is starting or stopping", () => {
    expect(
      isAppRunLoading({
        phase: "starting",
        admissionKind: "idle",
        executionKind: "idle",
      }),
    ).toBe(true);
    expect(
      isAppRunLoading({
        phase: "idle",
        admissionKind: "preparing",
        executionKind: "idle",
      }),
    ).toBe(true);
  });
});

describe("app-run remote selectors", () => {
  it("exposes ready and reloading URLs as a running-server signal", () => {
    const url = {
      appUrl: "http://localhost:4200",
      originalUrl: "http://localhost:3200",
      mode: "host" as const,
    };

    for (const state of [
      { type: "ready", appId: 7, invocationRef, url },
      {
        type: "reloading",
        appId: 7,
        invocationRef,
        reason: "manual",
        url,
      },
    ] satisfies RunState[]) {
      expect(selectRemoteAppUrl(snapshot(state))).toEqual({ ...url, appId: 7 });
    }
  });

  it("projects only an observed process exit", () => {
    expect(
      selectRemoteAppExit(
        snapshot({
          type: "stopped",
          appId: 7,
          invocationRef,
          exitCode: 1,
          timestamp: 100,
        }),
      ),
    ).toEqual({ appId: 7, exitCode: 1, timestamp: 100 });
    expect(
      selectRemoteAppExit(
        snapshot({
          type: "errored",
          appId: 7,
          invocationRef,
          error: { message: "failed" },
        }),
      ),
    ).toBeNull();
  });
});
