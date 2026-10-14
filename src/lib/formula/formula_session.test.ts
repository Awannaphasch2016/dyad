import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it } from "vitest";
import type { ControlPlaneDb } from "@/control_plane/db";
import { listRecentFormulaRevisions } from "@/control_plane/formula_revisions";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import * as schema from "@/control_plane/schema";
import {
  loadFormulaPage,
  saveFormulaPage,
  undoFormulaPage,
  validateFormulaPage,
  type FormulaSessionDeps,
} from "./formula_session";
import type { FormulaFetch, FormulaSupervisor } from "./gascity_formula_client";

const supervisor: FormulaSupervisor = {
  baseUrl: "https://city.example/",
  cityName: "wewebplus",
  writeGrant: null,
};

async function openDb(): Promise<ControlPlaneDb> {
  const client = new PGlite();
  const plane = drizzle(client, { schema });
  await migrate(plane, { migrationsFolder: "control-plane/drizzle" });
  return plane as unknown as ControlPlaneDb;
}

function scriptedFetch(
  steps: Array<
    (
      url: string,
      method: string,
      body?: string,
    ) => { status: number; body: string }
  >,
): { fetch: FormulaFetch; calls: string[] } {
  const calls: string[] = [];
  let index = 0;
  const fetch: FormulaFetch = async (url, init) => {
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url}`);
    const step = steps[index];
    index += 1;
    if (!step) throw new Error(`unexpected ${method} ${url}`);
    const result = step(url, method, init?.body);
    return { status: result.status, text: async () => result.body };
  };
  return { fetch, calls };
}

describe("formula session", () => {
  it("shows the starter when GasCity has no file and writes history only after a save", async () => {
    const db = await openDb();
    const { fetch, calls } = scriptedFetch([
      () => ({ status: 404, body: "" }),
      () => ({
        status: 200,
        body: JSON.stringify({ valid: true, errors: [] }),
      }),
      () => ({ status: 200, body: JSON.stringify({ status: "saved" }) }),
    ]);
    const deps: FormulaSessionDeps = {
      supervisor,
      db,
      fetch,
      createId: () => "rev-1",
    };

    const loaded = await loadFormulaPage(deps, "discovery");
    expect(loaded.source).toBe("starter");
    expect(loaded.text).toContain('formula = "discovery"');
    expect(loaded.canUndo).toBe(false);

    const saved = await saveFormulaPage(deps, "discovery", loaded.text);
    expect(saved.valid).toBe(true);
    const rows = await listRecentFormulaRevisions(db, "discovery", 5);
    expect(rows.map((row) => row.body)).toEqual([loaded.text]);
    expect(await listRecentFormulaRevisions(db, "implementation", 5)).toEqual(
      [],
    );
    expect(calls.join("\n")).not.toMatch(/cook|sling|beads/);
  });

  it("rejects a broken formula before writing the file or the history", async () => {
    const db = await openDb();
    const { fetch, calls } = scriptedFetch([
      () => ({
        status: 200,
        body: JSON.stringify({
          valid: false,
          errors: ["steps[0] (discover): title is required"],
        }),
      }),
    ]);
    const deps: FormulaSessionDeps = {
      supervisor,
      db,
      fetch,
      createId: () => "rev-2",
    };
    const result = await saveFormulaPage(
      deps,
      "discovery",
      'formula = "discovery"\n',
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(["steps[0] (discover): title is required"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("/validate");
    expect(await listRecentFormulaRevisions(db, "discovery", 5)).toEqual([]);
  });

  it("undo writes the previous text back and appends it", async () => {
    const db = await openDb();
    const responses = [
      { status: 200, body: JSON.stringify({ valid: true, errors: [] }) },
      { status: 200, body: JSON.stringify({ status: "saved" }) },
      { status: 200, body: JSON.stringify({ valid: true, errors: [] }) },
      { status: 200, body: JSON.stringify({ status: "saved" }) },
      { status: 200, body: JSON.stringify({ status: "saved" }) },
    ];
    let index = 0;
    const fetch: FormulaFetch = async () => {
      const result = responses[index];
      index += 1;
      if (!result) throw new Error("unexpected request");
      return { status: result.status, text: async () => result.body };
    };
    let ids = 0;
    const deps: FormulaSessionDeps = {
      supervisor,
      db,
      fetch,
      createId: () => `rev-${(ids += 1)}`,
    };
    await saveFormulaPage(deps, "delivery", "first");
    await saveFormulaPage(deps, "delivery", "second");
    const undone = await undoFormulaPage(deps, "delivery");
    expect(undone.text).toBe("first");
    const rows = await listRecentFormulaRevisions(db, "delivery", 5);
    expect(rows.map((row) => row.body)).toEqual(["first", "second", "first"]);
  });

  it("does not call GasCity when the supervisor address is missing", async () => {
    const fetch: FormulaFetch = async () => {
      throw new Error("should not fetch");
    };
    const loaded = await loadFormulaPage(
      { supervisor: null, db: null, fetch },
      "implementation",
    );
    expect(loaded.supervisorConfigured).toBe(false);
    expect(loaded.text).toContain('formula = "implementation"');
    await expect(
      validateFormulaPage(
        { supervisor: null, db: null, fetch },
        "implementation",
        loaded.text,
      ),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Precondition,
    } satisfies Partial<DyadError>);
  });
});
