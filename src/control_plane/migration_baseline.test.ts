import { describe, expect, it } from "vitest";
import { migrationBaselineWhen } from "./migration_baseline";

const entries = [
  { tag: "0000_control_plane", when: 100 },
  { tag: "0001_hitl", when: 200 },
  { tag: "0002_gate_resolved_at", when: 300 },
];

describe("migrationBaselineWhen", () => {
  it("leaves a missing schema for migrate to create", () => {
    expect(
      migrationBaselineWhen(entries, {
        "0000_control_plane": false,
      }),
    ).toBeNull();
  });

  it("stamps the first migration when only its tables exist", () => {
    expect(
      migrationBaselineWhen(entries, {
        "0000_control_plane": true,
        "0001_hitl": false,
      }),
    ).toBe(100);
  });

  it("stamps through the last migration whose objects exist", () => {
    expect(
      migrationBaselineWhen(entries, {
        "0000_control_plane": true,
        "0001_hitl": true,
        "0002_gate_resolved_at": true,
      }),
    ).toBe(300);
  });

  it("stops before a journal entry that was not probed", () => {
    expect(
      migrationBaselineWhen(
        [...entries, { tag: "0003_runtime_run", when: 400 }],
        {
          "0000_control_plane": true,
          "0001_hitl": true,
          "0002_gate_resolved_at": true,
        },
      ),
    ).toBe(300);
  });
});
