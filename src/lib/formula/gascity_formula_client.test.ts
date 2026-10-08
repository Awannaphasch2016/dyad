import { describe, expect, it } from "vitest";
import {
  formulaRequestPath,
  loadFormulaSource,
  readSupervisorConfig,
  upsertFormulaText,
  validateFormulaText,
  type FormulaFetch,
  type FormulaSupervisor,
} from "./gascity_formula_client";

const supervisor: FormulaSupervisor = {
  baseUrl: "https://city.example",
  cityName: "wewebplus",
  writeGrant: "grant-1",
};

function fakeFetch(
  handler: (
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string },
  ) => {
    status: number;
    body: string;
  },
): {
  fetch: FormulaFetch;
  calls: Array<{
    url: string;
    method: string;
    body?: string;
    headers?: Record<string, string>;
  }>;
} {
  const calls: Array<{
    url: string;
    method: string;
    body?: string;
    headers?: Record<string, string>;
  }> = [];
  const fetch: FormulaFetch = async (url, init) => {
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body,
      headers: init?.headers,
    });
    const result = handler(url, init);
    return { status: result.status, text: async () => result.body };
  };
  return { fetch, calls };
}

describe("GasCity formula client", () => {
  it("builds source, validate, and upsert paths and refuses bead execution", () => {
    expect(formulaRequestPath("wewebplus", "discovery", "source")).toBe(
      "/v0/city/wewebplus/formulas/discovery/source",
    );
    expect(formulaRequestPath("wewebplus", "implementation", "validate")).toBe(
      "/v0/city/wewebplus/formulas/implementation/validate",
    );
    expect(formulaRequestPath("wewebplus", "delivery", "upsert")).toBe(
      "/v0/city/wewebplus/formulas/delivery",
    );
    expect(() =>
      formulaRequestPath("wewebplus", "discovery", "source"),
    ).not.toThrow();
  });

  it("loads, validates, and saves without calling cook, sling, or beads", async () => {
    const { fetch, calls } = fakeFetch((url, init) => {
      if (init?.method === "POST") {
        return {
          status: 200,
          body: JSON.stringify({ valid: true, errors: [] }),
        };
      }
      if (init?.method === "PUT") {
        return { status: 200, body: JSON.stringify({ status: "saved" }) };
      }
      return {
        status: 200,
        body: JSON.stringify({
          name: "discovery",
          source: 'formula = "discovery"\n',
        }),
      };
    });

    await expect(
      loadFormulaSource(supervisor, "discovery", fetch),
    ).resolves.toContain('formula = "discovery"');
    await validateFormulaText(
      supervisor,
      "discovery",
      'formula = "discovery"\n',
      fetch,
    );
    await upsertFormulaText(
      supervisor,
      "discovery",
      'formula = "discovery"\n',
      fetch,
    );

    const urls = calls.map((call) => `${call.method} ${call.url}`);
    expect(urls).toEqual([
      "GET https://city.example/v0/city/wewebplus/formulas/discovery/source",
      "POST https://city.example/v0/city/wewebplus/formulas/discovery/validate",
      "PUT https://city.example/v0/city/wewebplus/formulas/discovery",
    ]);
    for (const call of calls) {
      expect(call.url).not.toMatch(/cook|sling|beads|\/bead\//);
      expect(call.headers?.["X-GC-Request"]).toBe("formula-page");
    }
    expect(calls[1]?.headers?.["X-GC-City-Write"]).toBeUndefined();
    expect(calls[2]?.headers?.["X-GC-City-Write"]).toBe("grant-1");
  });

  it("treats a missing city file as no source", async () => {
    const { fetch } = fakeFetch(() => ({ status: 404, body: "" }));
    await expect(
      loadFormulaSource(supervisor, "delivery", fetch),
    ).resolves.toBeNull();
  });

  it("reads the supervisor address only when both values are set", () => {
    expect(readSupervisorConfig({})).toBeNull();
    expect(
      readSupervisorConfig({
        GAS_CITY_SUPERVISOR_URL: "https://city.example",
        GAS_CITY_CITY_NAME: "wewebplus",
      })?.cityName,
    ).toBe("wewebplus");
  });
});
